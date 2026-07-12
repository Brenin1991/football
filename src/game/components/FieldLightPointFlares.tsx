import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AddEquation,
  AdditiveBlending,
  Color,
  ConeGeometry,
  CustomBlending,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OneFactor,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  SpotLight,
  SRGBColorSpace,
  SrcAlphaFactor,
  TextureLoader,
  Vector3,
  type Group,
  type Object3D as ThreeObject3D,
  type Texture,
} from 'three'
import { FIELD_SCALE } from '../systems/fieldData'
import { LIGHT_POINT_FLARES } from '../graphics/lightPointFlareSettings'

const _camQ = new Quaternion()
const _parentQ = new Quaternion()
const _poleWorld = new Vector3()

type PoleKit = {
  pointLight?: PointLight
  spotLight?: SpotLight
  spotTarget?: Object3D
  volCone?: Mesh
  flareMesh?: Mesh
  _tpBasePointIntensity?: number
  _tpBaseSpotIntensity?: number
  _tpBaseVolStrength?: number
  _tpBaseFlareOpacity?: number
  _tpPoleRowRegistered?: boolean
}

type WorldAnchor = { x: number; y: number; z: number; valid: boolean }

function parseColor(hex: string | undefined, fallback: string) {
  try {
    return new Color(hex ?? fallback)
  } catch {
    return new Color(fallback)
  }
}

const VOL_CONE_VERT = `
uniform float uHeight;
varying vec3 vLocal;
varying float vAlong;

void main() {
  vLocal = position;
  vAlong = clamp((0.5 * uHeight - position.y) / max(uHeight, 1e-4), 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const VOL_CONE_FRAG = `
uniform vec3 uColor;
uniform float uStrength;
uniform float uHeightFalloff;
uniform float uNoiseScale;
uniform float uNoiseScroll;
uniform float uBaseRadius;
uniform float uHeight;
uniform float uTime;

varying vec3 vLocal;
varying float vAlong;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  float maxR = max(0.001, uBaseRadius * vAlong);
  float d = length(vLocal.xz);
  float radial = 1.0 - smoothstep(maxR * 0.68, maxR * 1.06, d);
  radial = pow(max(radial, 0.0), 1.28);
  float vertical = pow(1.0 - vAlong * 0.28, uHeightFalloff) * (1.0 - vAlong * 0.1);
  vec3 q = vLocal * uNoiseScale + vec3(0.0, uTime * uNoiseScroll, uTime * 0.11);
  float n = hash31(floor(q * 3.7)) * 0.55 + hash31(floor(q * 1.9)) * 0.45;
  float dust = 0.68 + 0.32 * n;
  float intensity = radial * vertical * uStrength * dust;
  if (intensity < 0.006) discard;
  float alpha = clamp(intensity, 0.0, 0.42);
  gl_FragColor = vec4(uColor * alpha, alpha);
}
`

function applyPoleDistanceFactor(kit: PoleKit, factor: number, flareEnabled: boolean) {
  const f = MathUtils.clamp(factor, 0, 1)

  if (kit.pointLight) {
    kit.pointLight.visible = f > 0.001
    kit.pointLight.intensity = (kit._tpBasePointIntensity ?? 0) * f
  }
  if (kit.spotLight) {
    const on = f > 0.001
    kit.spotLight.visible = on
    kit.spotLight.intensity = (kit._tpBaseSpotIntensity ?? 0) * f
    if (kit.spotLight.castShadow) {
      kit.spotLight.castShadow = on
    }
  }
  if (kit.flareMesh?.material) {
    const mat = kit.flareMesh.material as MeshBasicMaterial
    if (flareEnabled === false) {
      kit.flareMesh.visible = false
    } else {
      kit.flareMesh.visible = f > 0.001
      mat.opacity = (kit._tpBaseFlareOpacity ?? 1) * f
    }
  }
  if (kit.volCone?.material instanceof ShaderMaterial) {
    const u = kit.volCone.material.uniforms.uStrength
    if (u) {
      kit.volCone.visible = f > 0.001
      u.value = (kit._tpBaseVolStrength ?? 1) * f
    }
  }
}

type Props = {
  mapScene: Group | ThreeObject3D
  worldAnchorRef?: React.MutableRefObject<WorldAnchor | null>
  daylight?: number
}

/** Só nós-âncora do GLB — ignora filhos criados pelo sistema (flare, cone, luz). */
function isStadiumLightPoleNode(node: ThreeObject3D, needle: string): boolean {
  if (node.userData.__tpStreetLightPart) return false
  if (node.userData.__tpLightFlare) return false
  const nm = String(node.name ?? '').toLowerCase()
  if (!nm.includes(needle)) return false
  if (nm.startsWith('field_') || nm.startsWith('tp_')) return false
  return true
}

const FieldLightPointFlaresInner = memo(function FieldLightPointFlaresInner({
  mapScene,
  worldAnchorRef,
  daylight = 0,
}: Props) {
  const cfg = LIGHT_POINT_FLARES
  const meshesRef = useRef<Mesh[]>([])
  const polesRef = useRef<{ node: ThreeObject3D; kit: PoleKit }[]>([])
  const sharedFlareGeoRef = useRef<PlaneGeometry | null>(null)
  const sharedVolGeoRef = useRef<ConeGeometry | null>(null)
  const billboardFlaresRef = useRef<Mesh[]>([])
  const sortScratchRef = useRef<{ dist: number; kit: PoleKit; factor: number }[]>([])

  const path = cfg.texturePath
  const [flareTex, setFlareTex] = useState<Texture | null>(null)
  const loadedTexRef = useRef<Texture | null>(null)

  useEffect(() => {
    let cancelled = false
    const loader = new TextureLoader()
    loader.load(
      path,
      (texture) => {
        texture.colorSpace = SRGBColorSpace
        texture.needsUpdate = true
        if (cancelled) {
          texture.dispose()
          return
        }
        loadedTexRef.current = texture
        setFlareTex(texture)
      },
      undefined,
      () => {
        if (!cancelled) setFlareTex(null)
      },
    )
    return () => {
      cancelled = true
      loadedTexRef.current?.dispose()
      loadedTexRef.current = null
      setFlareTex(null)
    }
  }, [path])

  useLayoutEffect(() => {
    const needle = cfg.nodeNameIncludes.toLowerCase()
    const plCfg = cfg.pointLight
    const usePoint = cfg.usePointLight && plCfg.enabled !== false
    const useSpot = cfg.useRealSpots && cfg.spotLight.enabled !== false && !usePoint
    const slCfg = cfg.spotLight
    const spotEnabled = useSpot

    const plColor = parseColor(plCfg.color, '#ffd9b0')
    const plIntensity = plCfg.intensity
    const plDistance = plCfg.distance
    const plDecay = plCfg.decay

    const slColor = parseColor(slCfg.color, '#ffedd0')
    const slIntensity = slCfg.intensity
    const slDistance = slCfg.distance
    const slAngle = slCfg.angle
    const slPenumbra = slCfg.penumbra
    const slDecay = slCfg.decay
    const slCastShadow = slCfg.castShadow
    const slShadowMap = 512
    const slShadowRadius = 2.5
    const slShadowFocus = 0.92
    const slShadowCamNear = 0.28
    const shadowBiasScale = Math.sqrt(MathUtils.clamp(FIELD_SCALE, 1, 24))
    const [tlx, tly, tlz] = slCfg.targetLocal

    const poleRows: { node: ThreeObject3D; kit: PoleKit }[] = []
    mapScene.updateMatrixWorld(true)
    mapScene.traverse((node) => {
      if (!node || typeof (node as ThreeObject3D).add !== 'function') return
      if (!isStadiumLightPoleNode(node as ThreeObject3D, needle)) return

      const obj = node as ThreeObject3D & { userData: Record<string, unknown> }
      let kit = obj.userData.__tpStreetLightKit as PoleKit | undefined
      if (!kit) {
        kit = {}
        obj.userData.__tpStreetLightKit = kit
      }

      if (usePoint && !kit.pointLight) {
        const p = new PointLight(plColor, plIntensity, plDistance, plDecay)
        p.name = 'field_pole_point'
        p.userData.__tpStreetLightPart = true
        obj.add(p)
        kit.pointLight = p
        kit._tpBasePointIntensity = plIntensity
      }

      if (spotEnabled && !kit.spotLight) {
        const spot = new SpotLight(slColor, slIntensity, slDistance, slAngle, slPenumbra, slDecay)
        spot.name = 'field_pole_spot'
        spot.userData.__tpStreetLightPart = true
        if (slCastShadow) {
          spot.castShadow = true
          spot.shadow.autoUpdate = true
          spot.shadow.mapSize.setScalar(slShadowMap)
          spot.shadow.bias = -0.00025 * shadowBiasScale
          spot.shadow.normalBias = 0.045 * shadowBiasScale
          spot.shadow.radius = slShadowRadius
          spot.shadow.focus = slShadowFocus
          spot.shadow.camera.near = slShadowCamNear
          spot.shadow.needsUpdate = true
        }
        const target = new Object3D()
        target.name = 'field_pole_spot_target'
        target.userData.__tpStreetLightPart = true
        target.position.set(tlx, tly, tlz)
        obj.add(spot)
        obj.add(target)
        spot.target = target
        kit.spotLight = spot
        kit.spotTarget = target
        kit._tpBaseSpotIntensity = slIntensity
      }

      if (!kit._tpPoleRowRegistered && (kit.pointLight || kit.spotLight)) {
        kit._tpPoleRowRegistered = true
        poleRows.push({ node: obj, kit })
      }

      const vcfg = cfg.volumetric
      if (vcfg.enabled !== false && (kit.pointLight || kit.spotLight) && !kit.volCone) {
        const H = vcfg.length
        const R = vcfg.radius
        const beamColor = parseColor(vcfg.color ?? plCfg.color ?? cfg.color, '#c87828')

        if (!sharedVolGeoRef.current) {
          sharedVolGeoRef.current = new ConeGeometry(R, H, vcfg.radialSegments, vcfg.heightSegments)
        }

        const mat = new ShaderMaterial({
          uniforms: {
            uHeight: { value: H },
            uBaseRadius: { value: R },
            uColor: { value: new Vector3(beamColor.r, beamColor.g, beamColor.b) },
            uStrength: { value: vcfg.strength },
            uHeightFalloff: { value: vcfg.heightFalloff },
            uNoiseScale: { value: vcfg.noiseScale },
            uNoiseScroll: { value: vcfg.noiseScroll },
            uTime: { value: 0 },
          },
          vertexShader: VOL_CONE_VERT,
          fragmentShader: VOL_CONE_FRAG,
          transparent: true,
          depthWrite: false,
          depthTest: vcfg.depthTest,
          blending: CustomBlending,
          blendSrc: SrcAlphaFactor,
          blendDst: OneFactor,
          blendEquation: AddEquation,
          side: DoubleSide,
          fog: !vcfg.ignoreSceneFog,
          toneMapped: false,
        })
        const mesh = new Mesh(sharedVolGeoRef.current, mat)
        mesh.name = 'field_light_volumetric_cone'
        mesh.userData.__tpStreetLightPart = true
        mesh.frustumCulled = true
        mesh.renderOrder = vcfg.renderOrder
        mesh.position.set(0, -H * 0.5, 0)
        obj.add(mesh)
        kit.volCone = mesh
        kit._tpBaseVolStrength = vcfg.strength
      }
    })
    polesRef.current = poleRows

    return () => {
      mapScene.traverse((node) => {
        const obj = node as ThreeObject3D & { userData: Record<string, unknown> }
        const kit = obj.userData.__tpStreetLightKit as PoleKit | undefined
        if (!kit) return

        if (kit.pointLight) {
          obj.remove(kit.pointLight)
          kit.pointLight = undefined
        }
        if (kit.spotLight) {
          kit.spotLight.target = kit.spotTarget ?? kit.spotLight.target
          obj.remove(kit.spotLight)
          kit.spotLight = undefined
        }
        if (kit.spotTarget) {
          obj.remove(kit.spotTarget)
          kit.spotTarget = undefined
        }
        if (kit.volCone) {
          obj.remove(kit.volCone)
          const vm = kit.volCone.material
          if (vm && !Array.isArray(vm)) vm.dispose()
          kit.volCone = undefined
        }
        kit._tpBasePointIntensity = undefined
        kit._tpBaseSpotIntensity = undefined
        kit._tpBaseVolStrength = undefined
        kit._tpPoleRowRegistered = false
        if (!kit.flareMesh) {
          delete obj.userData.__tpStreetLightKit
        }
      })
      polesRef.current = []
      sharedVolGeoRef.current?.dispose()
      sharedVolGeoRef.current = null
    }
  }, [mapScene, cfg])

  useLayoutEffect(() => {
    const flareEnabled = cfg.flare.enabled !== false
    const needle = cfg.nodeNameIncludes.toLowerCase()
    const scale = cfg.billboardScale
    const opacity = cfg.opacity

    if (!sharedFlareGeoRef.current) {
      sharedFlareGeoRef.current = new PlaneGeometry(scale, scale)
    }
    const sharedFlareGeo = sharedFlareGeoRef.current
    const flareMeshes: Mesh[] = []

    mapScene.updateMatrixWorld(true)
    mapScene.traverse((node) => {
      if (!node || typeof (node as ThreeObject3D).add !== 'function') return
      if (!isStadiumLightPoleNode(node as ThreeObject3D, needle)) return

      const obj = node as ThreeObject3D & { userData: Record<string, unknown> }
      const kit = obj.userData.__tpStreetLightKit as PoleKit | undefined
      if (!kit || (!kit.pointLight && !kit.spotLight)) return

      if (!flareEnabled) {
        if (kit.flareMesh) {
          kit.flareMesh.visible = false
          const mat = kit.flareMesh.material as MeshBasicMaterial
          mat.opacity = 0
        }
        return
      }

      if (!kit.flareMesh) {
        const mat = new MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: cfg.depthTest,
          blending: AdditiveBlending,
          toneMapped: cfg.toneMapped,
          fog: !cfg.ignoreSceneFog,
        })
        if (cfg.color) {
          mat.color = new Color(cfg.color)
        }
        const mesh = new Mesh(sharedFlareGeo, mat)
        mesh.frustumCulled = false
        mesh.renderOrder = 990
        mesh.name = 'field_light_flare'
        mesh.userData.__tpLightFlare = true
        mesh.visible = false
        obj.add(mesh)
        kit.flareMesh = mesh
        kit._tpBaseFlareOpacity = opacity
      }

      const mat = kit.flareMesh.material as MeshBasicMaterial
      if (flareTex) {
        mat.map = flareTex
        kit._tpBaseFlareOpacity = opacity
        mat.opacity = opacity
        mat.needsUpdate = true
      } else {
        mat.map = null
        mat.opacity = 0
        mat.needsUpdate = true
        kit.flareMesh.visible = false
      }

      flareMeshes.push(kit.flareMesh)
    })

    meshesRef.current = flareMeshes
    billboardFlaresRef.current = flareMeshes

    return () => {
      mapScene.traverse((node) => {
        const obj = node as ThreeObject3D & { userData: Record<string, unknown> }
        const kit = obj.userData.__tpStreetLightKit as PoleKit | undefined
        if (!kit?.flareMesh) return
        obj.remove(kit.flareMesh)
        const fm = kit.flareMesh.material
        if (fm && !Array.isArray(fm)) fm.dispose()
        kit.flareMesh = undefined
        kit._tpBaseFlareOpacity = undefined
        if (!kit.pointLight && !kit.spotLight && !kit.volCone) {
          delete obj.userData.__tpStreetLightKit
        }
      })
      meshesRef.current = []
      billboardFlaresRef.current = []
      sharedFlareGeoRef.current?.dispose()
      sharedFlareGeoRef.current = null
    }
  }, [mapScene, flareTex, cfg])

  const cullAccumRef = useRef(1e9)
  const volTimeRef = useRef(0)

  useFrame(({ camera }, delta) => {
    const poles = polesRef.current
    volTimeRef.current += delta
    const volT = volTimeRef.current
    for (const { kit } of poles) {
      const cone = kit.volCone
      if (cone?.material instanceof ShaderMaterial) {
        const u = cone.material.uniforms.uTime
        if (u) u.value = volT
      }
    }

    const flareEnabled = cfg.flare.enabled !== false
    const daylightOffThreshold = MathUtils.clamp(cfg.daylightOffThreshold, 0, 1)
    const daylightFadeRange = Math.min(1, Math.max(1e-4, cfg.daylightFadeRange))
    const nightStart = Math.max(0, daylightOffThreshold - daylightFadeRange)
    const nightLightFactor =
      cfg.daylightOffThreshold <= 0
        ? 1
        : MathUtils.clamp(
            (daylightOffThreshold - daylight) / Math.max(1e-4, daylightOffThreshold - nightStart),
            0,
            1,
          )

    const dc = cfg.distanceCulling
    const cullOn = dc.enabled !== false && worldAnchorRef?.current
    const allFlares = meshesRef.current

    if (poles.length === 0) return

    if (!cullOn) {
      const bill = billboardFlaresRef.current
      bill.length = 0
      for (const { kit } of poles) {
        applyPoleDistanceFactor(kit, nightLightFactor || 1, flareEnabled)
        if (kit.flareMesh?.visible) bill.push(kit.flareMesh)
      }
    } else {
      const hz = dc.updateHz
      cullAccumRef.current += delta
      if (cullAccumRef.current >= 1 / hz) {
        cullAccumRef.current = 0
        const store = worldAnchorRef!.current
        if (!store?.valid) {
          const bill = billboardFlaresRef.current
          bill.length = 0
          for (const { kit } of poles) {
            applyPoleDistanceFactor(kit, nightLightFactor || 1, flareEnabled)
            if (kit.flareMesh?.visible) bill.push(kit.flareMesh)
          }
        } else {
          const maxD = dc.maxDistance
          const fadeStart = Math.min(dc.fadeStartDistance, maxD - 1e-3)
          const fadeSpan = Math.max(1e-3, maxD - fadeStart)
          const cap = dc.maxSimultaneousSpots === 0 ? Infinity : dc.maxSimultaneousSpots

          const scratch = sortScratchRef.current
          scratch.length = 0
          for (const { node, kit } of poles) {
            node.getWorldPosition(_poleWorld)
            const dx = _poleWorld.x - store.x
            const dy = _poleWorld.y - store.y
            const dz = _poleWorld.z - store.z
            const dist = Math.hypot(dx, dy, dz)
            let factor = 1
            if (dist >= maxD) factor = 0
            else if (dist > fadeStart) factor = (maxD - dist) / fadeSpan
            scratch.push({ dist, kit, factor })
          }
          scratch.sort((a, b) => a.dist - b.dist)

          const bill = billboardFlaresRef.current
          bill.length = 0
          for (let j = 0; j < scratch.length; j++) {
            const { kit, factor: distFactor } = scratch[j]
            let f = distFactor * (nightLightFactor || 1)
            if (Number.isFinite(cap) && j >= cap) f = 0
            applyPoleDistanceFactor(kit, f, flareEnabled)
            if (kit.flareMesh?.visible) bill.push(kit.flareMesh)
          }
        }
      }
    }

    const list = billboardFlaresRef.current.length > 0 ? billboardFlaresRef.current : allFlares
    camera.getWorldQuaternion(_camQ)
    for (const mesh of list) {
      if (!mesh.visible) continue
      const parent = mesh.parent
      if (!parent) continue
      parent.getWorldQuaternion(_parentQ)
      mesh.quaternion.copy(_parentQ).invert().multiply(_camQ)
    }
  })

  return null
})

export function FieldLightPointFlares(props: Props) {
  if (!LIGHT_POINT_FLARES.enabled || !props.mapScene) return null
  return <FieldLightPointFlaresInner {...props} />
}

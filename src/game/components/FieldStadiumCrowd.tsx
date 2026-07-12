import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AdditiveBlending,
  Box3,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Group,
  type Object3D as ThreeObject3D,
  type Texture,
} from 'three'
import {
  loadAnimatedGifTexture,
  type AnimatedGifTexture,
} from '../graphics/loadAnimatedGifTexture'
import { STADIUM_CROWD } from '../graphics/stadiumCrowdSettings'

const _box = new Box3()
const _worldPos = new Vector3()
const _normal = new Vector3()
const _parentQ = new Quaternion()
const _camQ = new Quaternion()

type CrowdAnchor = {
  node: ThreeObject3D
  meshes: Mesh[]
}

type FlashSlot = {
  mesh: Mesh
  mat: MeshBasicMaterial
  hostPanel: Mesh | null
  localOffset: Vector3
  phase: 'wait' | 'flash'
  timer: number
  waitDuration: number
  flashDuration: number
}

type Props = {
  mapScene: Group | ThreeObject3D
}

function randRange(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function isCheeringAreaNode(node: ThreeObject3D, needle: string): boolean {
  if (node.userData.__tpCrowdPart) return false
  const nm = String(node.name ?? '').toLowerCase()
  if (!nm.includes(needle)) return false
  if (nm.startsWith('field_') || nm.startsWith('tp_')) return false
  return true
}

function createCrowdMaterial(tex: Texture, toneMapped: boolean) {
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: STADIUM_CROWD.depthWrite,
    depthTest: STADIUM_CROWD.depthTest,
    toneMapped,
    side: DoubleSide,
  })

  const ck = STADIUM_CROWD.chromaKey
  if (!ck.enabled) return mat

  const t0 = ck.threshold.toFixed(4)
  const t1 = (ck.threshold + ck.smoothness).toFixed(4)
  const minG = ck.minGreen.toFixed(4)

  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float gb = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
      float keyAmt = smoothstep(${t0}, ${t1}, gb) * step(${minG}, diffuseColor.g);
      diffuseColor.a *= 1.0 - keyAmt;
      if (diffuseColor.a < 0.04) discard;`,
    )
  }
  mat.customProgramCacheKey = () => `tp_crowd_greenscreen_${t0}_${t1}_${minG}`
  return mat
}

function createFlashMaterial(tex: Texture, threshold: number, depthTest: boolean) {
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest,
    toneMapped: false,
    opacity: 0,
  })
  const key = threshold.toFixed(4)
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      if (dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) < ${key}) discard;`,
    )
  }
  mat.customProgramCacheKey = () => `tp_crowd_flash_${key}`
  return mat
}

function buildCrowdTiles(
  anchor: ThreeObject3D,
  mapScene: ThreeObject3D,
  geo: PlaneGeometry,
  mat: MeshBasicMaterial,
  personHeight: number,
  tileOverlap: number,
  surfaceOffset: number,
  renderOrder: number,
  panelBudget: { remaining: number },
): Mesh[] {
  _box.setFromObject(anchor)
  const sizeX = _box.max.x - _box.min.x
  const sizeZ = _box.max.z - _box.min.z
  const alongZ = sizeZ >= sizeX
  const alongLen = alongZ ? sizeZ : sizeX
  const crossLen = alongZ ? sizeX : sizeZ

  const stripW = geo.parameters.width
  const step = Math.max(stripW * tileOverlap, 0.01)

  const countAlong = Math.max(1, Math.floor(alongLen / step))
  const countCross = Math.max(1, Math.floor(crossLen / step))

  anchor.updateMatrixWorld(true)
  _normal.set(0, 0, 1).transformDirection(anchor.matrixWorld).normalize()

  const meshes: Mesh[] = []
  const baseY = _box.min.y + personHeight * 0.5
  const alongStart = (alongZ ? _box.min.z : _box.min.x) + stripW * 0.5
  const crossStart = (alongZ ? _box.min.x : _box.min.z) + stripW * 0.5
  const alongSpan = Math.max(alongLen - stripW, 0)
  const crossSpan = Math.max(crossLen - stripW, 0)

  for (let i = 0; i < countAlong; i++) {
    const alongT = countAlong <= 1 ? 0.5 : i / (countAlong - 1)
    const alongPos = alongStart + alongSpan * alongT

    for (let j = 0; j < countCross; j++) {
      if (panelBudget.remaining <= 0) return meshes

      const crossT = countCross <= 1 ? 0.5 : j / (countCross - 1)
      const crossPos = crossStart + crossSpan * crossT

      _worldPos.set(
        alongZ ? crossPos : alongPos,
        baseY,
        alongZ ? alongPos : crossPos,
      )
      _worldPos.addScaledVector(_normal, surfaceOffset)
      mapScene.worldToLocal(_worldPos)

      const mesh = new Mesh(geo, mat)
      mesh.position.copy(_worldPos)
      mesh.userData.__tpCrowdPart = true
      mesh.name = 'field_crowd_panel'
      mesh.renderOrder = renderOrder
      mesh.frustumCulled = false
      meshes.push(mesh)
      panelBudget.remaining -= 1
    }
  }

  return meshes
}

function billboardMesh(mesh: Mesh, cameraQ: Quaternion) {
  const parent = mesh.parent
  if (!parent) return
  parent.getWorldQuaternion(_parentQ)
  mesh.quaternion.copy(_parentQ).invert().multiply(cameraQ)
}
function mountFlashOnPanel(
  slot: FlashSlot,
  panel: Mesh,
  mapScene: ThreeObject3D,
  size: number,
) {
  if (slot.mesh.parent !== mapScene) {
    slot.mesh.parent?.remove(slot.mesh)
    mapScene.add(slot.mesh)
  }

  slot.hostPanel = panel
  const geo = panel.geometry as PlaneGeometry
  const pw = geo.parameters.width ?? size
  const ph = geo.parameters.height ?? size
  slot.localOffset.set(
    (Math.random() - 0.5) * pw * 0.72,
    (Math.random() - 0.5) * ph * 0.72,
    0.08,
  )
  slot.mesh.scale.setScalar(randRange(0.85, 1.35))
  slot.mat.opacity = 0
  slot.phase = 'wait'
  slot.timer = 0
  slot.waitDuration = 0
  slot.flashDuration = 0
}

function armFlash(
  slot: FlashSlot,
  panels: Mesh[],
  mapScene: ThreeObject3D,
  fc: typeof STADIUM_CROWD.cameraFlash,
  size: number,
) {
  if (panels.length === 0) return
  const panel = panels[Math.floor(Math.random() * panels.length)]!
  mountFlashOnPanel(slot, panel, mapScene, size)
  slot.waitDuration = randRange(fc.minWait, fc.maxWait)
  slot.flashDuration = randRange(fc.minDuration, fc.maxDuration)
  slot.phase = 'wait'
  slot.timer = randRange(0, slot.waitDuration * 0.85)
}

function updateFlashTransform(slot: FlashSlot, mapScene: ThreeObject3D, cameraQ: Quaternion) {
  const panel = slot.hostPanel
  if (!panel) return

  _worldPos.copy(slot.localOffset)
  panel.localToWorld(_worldPos)
  mapScene.worldToLocal(_worldPos)
  slot.mesh.position.copy(_worldPos)
  billboardMesh(slot.mesh, cameraQ)
}

function tickFlash(
  slot: FlashSlot,
  delta: number,
  panels: Mesh[],
  mapScene: ThreeObject3D,
  cameraQ: Quaternion,
  fc: typeof STADIUM_CROWD.cameraFlash,
  size: number,
) {
  if (panels.length === 0 || !slot.hostPanel) {
    slot.mat.opacity = 0
    return
  }

  updateFlashTransform(slot, mapScene, cameraQ)

  if (slot.phase === 'wait') {
    slot.mat.opacity = 0
    slot.timer += delta
    if (slot.timer >= slot.waitDuration) {
      slot.phase = 'flash'
      slot.timer = 0
    }
    return
  }

  slot.timer += delta
  const t = MathUtils.clamp(slot.timer / slot.flashDuration, 0, 1)
  slot.mat.opacity = Math.sin(t * Math.PI) * fc.maxOpacity

  if (slot.timer >= slot.flashDuration) {
    armFlash(slot, panels, mapScene, fc, size)
  }
}

const FieldStadiumCrowdInner = memo(function FieldStadiumCrowdInner({ mapScene }: Props) {
  const cfg = STADIUM_CROWD
  const anchorsRef = useRef<CrowdAnchor[]>([])
  const crowdMeshesRef = useRef<Mesh[]>([])
  const flashSlotsRef = useRef<FlashSlot[]>([])
  const flashGeoRef = useRef<PlaneGeometry | null>(null)
  const sharedGeoRef = useRef<PlaneGeometry | null>(null)
  const sharedMatRef = useRef<MeshBasicMaterial | null>(null)
  const gifRef = useRef<AnimatedGifTexture | null>(null)

  const [crowdTex, setCrowdTex] = useState<Texture | null>(null)
  const [flashTex, setFlashTex] = useState<Texture | null>(null)
  const [crowdPanelCount, setCrowdPanelCount] = useState(0)
  const staticTexRef = useRef<Texture | null>(null)
  const flashTexRef = useRef<Texture | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        if (cfg.animated && cfg.texturePath.endsWith('.gif')) {
          const gif = await loadAnimatedGifTexture(cfg.texturePath)
          if (cancelled) {
            gif.dispose()
            return
          }
          gifRef.current?.dispose()
          staticTexRef.current?.dispose()
          staticTexRef.current = null
          gifRef.current = gif
          setCrowdTex(gif.texture)
          return
        }

        const loader = new TextureLoader()
        loader.load(
          cfg.texturePath,
          (texture) => {
            texture.colorSpace = SRGBColorSpace
            texture.needsUpdate = true
            if (cancelled) {
              texture.dispose()
              return
            }
            gifRef.current?.dispose()
            gifRef.current = null
            staticTexRef.current?.dispose()
            staticTexRef.current = texture
            setCrowdTex(texture)
          },
          undefined,
          () => {
            if (!cancelled) setCrowdTex(null)
          },
        )
      } catch {
        if (!cancelled) setCrowdTex(null)
      }
    }

    void load()

    return () => {
      cancelled = true
      gifRef.current?.dispose()
      gifRef.current = null
      staticTexRef.current?.dispose()
      staticTexRef.current = null
    }
  }, [cfg.texturePath, cfg.animated])

  useEffect(() => {
    const fc = cfg.cameraFlash
    if (!fc.enabled) {
      setFlashTex(null)
      return
    }

    let cancelled = false
    const loader = new TextureLoader()
    loader.load(
      fc.texturePath,
      (texture) => {
        texture.colorSpace = SRGBColorSpace
        texture.needsUpdate = true
        if (cancelled) {
          texture.dispose()
          return
        }
        flashTexRef.current?.dispose()
        flashTexRef.current = texture
        setFlashTex(texture)
      },
      undefined,
      () => {
        if (!cancelled) setFlashTex(null)
      },
    )

    return () => {
      cancelled = true
      flashTexRef.current?.dispose()
      flashTexRef.current = null
    }
  }, [cfg.cameraFlash])

  useLayoutEffect(() => {
    if (!crowdTex) return

    const needle = cfg.nodeNameIncludes.toLowerCase()
    const personHeight = Math.max(cfg.personHeight, 0.5)
    const tileOverlap = MathUtils.clamp(cfg.tileOverlap, 0.5, 1)
    const aspect = crowdTex.image
      ? crowdTex.image.width / crowdTex.image.height
      : 16 / 9
    const stripW = personHeight * aspect

    sharedGeoRef.current?.dispose()
    sharedGeoRef.current = new PlaneGeometry(stripW, personHeight)
    sharedMatRef.current?.dispose()
    sharedMatRef.current = createCrowdMaterial(crowdTex, cfg.toneMapped)

    const geo = sharedGeoRef.current
    const mat = sharedMatRef.current
    const anchors: CrowdAnchor[] = []
    const allMeshes: Mesh[] = []
    const anchorNodes: Mesh[] = []

    mapScene.updateMatrixWorld(true)
    mapScene.traverse((node) => {
      if (!(node instanceof Mesh)) return
      if (!isCheeringAreaNode(node, needle)) return
      anchorNodes.push(node)
    })

    const maxTotal = cfg.maxPanels > 0 ? cfg.maxPanels : Number.POSITIVE_INFINITY
    const perAnchor = Number.isFinite(maxTotal)
      ? Math.max(1, Math.floor(maxTotal / Math.max(anchorNodes.length, 1)))
      : Number.POSITIVE_INFINITY
    let totalPlaced = 0

    for (const node of anchorNodes) {
      if (cfg.hideAnchorMesh) node.visible = false

      let allowed = perAnchor
      if (Number.isFinite(maxTotal)) {
        allowed = Math.min(perAnchor, maxTotal - totalPlaced)
        if (allowed <= 0) break
      }

      const meshes = buildCrowdTiles(
        node,
        mapScene,
        geo,
        mat,
        personHeight,
        tileOverlap,
        cfg.surfaceOffset,
        cfg.renderOrder,
        { remaining: allowed },
      )

      for (const mesh of meshes) {
        mapScene.add(mesh)
        allMeshes.push(mesh)
      }

      totalPlaced += meshes.length

      if (meshes.length > 0) {
        anchors.push({ node, meshes })
      }
    }

    anchorsRef.current = anchors
    crowdMeshesRef.current = allMeshes
    setCrowdPanelCount(allMeshes.length)

    return () => {
      for (const mesh of allMeshes) {
        mapScene.remove(mesh)
      }
      for (const anchor of anchors) {
        if (cfg.hideAnchorMesh) anchor.node.visible = true
      }
      anchorsRef.current = []
      crowdMeshesRef.current = []
      setCrowdPanelCount(0)
      sharedGeoRef.current?.dispose()
      sharedGeoRef.current = null
      sharedMatRef.current?.dispose()
      sharedMatRef.current = null
    }
  }, [mapScene, crowdTex, cfg])

  useLayoutEffect(() => {
    const fc = cfg.cameraFlash
    const panels = crowdMeshesRef.current

    for (const slot of flashSlotsRef.current) {
      mapScene.remove(slot.mesh)
      slot.mat.dispose()
    }
    flashSlotsRef.current = []
    flashGeoRef.current?.dispose()
    flashGeoRef.current = null

    if (!fc.enabled || !flashTex || panels.length === 0) return

    const size = Math.max(fc.size, 0.05)
    flashGeoRef.current = new PlaneGeometry(size, size)
    const slots: FlashSlot[] = []

    for (let i = 0; i < fc.maxActive; i++) {
      const mat = createFlashMaterial(flashTex, fc.blackKeyThreshold, fc.depthTest)
      const mesh = new Mesh(flashGeoRef.current, mat)
      mesh.name = 'field_crowd_camera_flash'
      mesh.userData.__tpCrowdPart = true
      mesh.renderOrder = fc.renderOrder
      mesh.frustumCulled = false
      mapScene.add(mesh)
      const slot: FlashSlot = {
        mesh,
        mat,
        hostPanel: null,
        localOffset: new Vector3(),
        phase: 'wait',
        timer: 0,
        waitDuration: 0,
        flashDuration: 0,
      }
      armFlash(slot, panels, mapScene, fc, size)
      slots.push(slot)
    }

    flashSlotsRef.current = slots

    return () => {
      for (const slot of slots) {
        mapScene.remove(slot.mesh)
        slot.mat.dispose()
      }
      flashSlotsRef.current = []
      flashGeoRef.current?.dispose()
      flashGeoRef.current = null
    }
  }, [cfg.cameraFlash, flashTex, crowdPanelCount, mapScene, cfg])

  useFrame(({ camera }, delta) => {
    gifRef.current?.tick(delta * 1000)

    camera.getWorldQuaternion(_camQ)

    for (const mesh of crowdMeshesRef.current) {
      if (!mesh.visible) continue
      billboardMesh(mesh, _camQ)
    }

    const fc = cfg.cameraFlash
    if (!fc.enabled) return
    const panels = crowdMeshesRef.current
    const size = Math.max(fc.size, 0.05)
    for (const slot of flashSlotsRef.current) {
      tickFlash(slot, delta, panels, mapScene, _camQ, fc, size)
    }
  })

  return null
})

export function FieldStadiumCrowd(props: Props) {
  if (!STADIUM_CROWD.enabled || !props.mapScene) return null
  return <FieldStadiumCrowdInner {...props} />
}

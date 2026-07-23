import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  HalfFloatType,
  LinearToneMapping,
  MathUtils,
  NoToneMapping,
  PCFSoftShadowMap,
  Quaternion,
  ReinhardToneMapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Mesh,
  type PerspectiveCamera,
  type ShadowMapType,
  type ToneMapping,
} from 'three'
// @ts-ignore three examples
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
// @ts-ignore three examples
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
// @ts-ignore three examples
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
// @ts-ignore three examples
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
// @ts-ignore three examples
import { TAARenderPass } from 'three/examples/jsm/postprocessing/TAARenderPass.js'
// @ts-ignore three examples
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
// @ts-ignore three examples
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
// @ts-ignore three examples
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { AAA_CLASSIC } from '../../graphics/aaaSettings'
import { createAaaPostShaders, hexToRgb01 } from '../../graphics/aaaPostShaders'
import {
  estimateCinematicFocusDistance,
  getCinematicDofStrength,
} from '../../systems/cinematicDof'

const _mbDq = new Quaternion()
const _mbAxis = new Vector3()
const _mbDpos = new Vector3()
const _mbInvQ = new Quaternion()
const _mbBlur = new Vector2()

type ShaderPassLike = InstanceType<typeof ShaderPass>
type SsaoPassLike = InstanceType<typeof SSAOPass> & {
  ssaoMaterial?: { uniforms: Record<string, { value: unknown }> }
  depthRenderMaterial?: { uniforms: Record<string, { value: unknown }> }
  overrideVisibility: () => void
  restoreVisibility: () => void
}

function materialUsesAlpha(mat: Material | null | undefined) {
  if (!mat) return false
  const m = mat as Material & {
    transparent?: boolean
    opacity?: number
    alphaMap?: unknown
    alphaTest?: number
  }
  if (m.transparent === true) return true
  if (typeof m.opacity === 'number' && m.opacity < 0.999) return true
  if (m.alphaMap) return true
  if (m.alphaTest && m.alphaTest > 0) return true
  return false
}

function meshUsesAlphaMaterial(obj: Mesh) {
  if (Array.isArray(obj.material)) {
    return obj.material.some((m) => materialUsesAlpha(m))
  }
  return materialUsesAlpha(obj.material)
}

function mapAoOutput(mode: string) {
  switch (mode.toLowerCase()) {
    case 'ssao':
      return SSAOPass.OUTPUT.SSAO
    case 'blur':
      return SSAOPass.OUTPUT.Blur
    case 'depth':
      return SSAOPass.OUTPUT.Depth
    case 'normal':
      return SSAOPass.OUTPUT.Normal
    default:
      return SSAOPass.OUTPUT.Default
  }
}

function resolveToneMapping(mode: typeof AAA_CLASSIC.color.toneMapping): ToneMapping {
  switch (mode) {
    case 'linear':
      return LinearToneMapping
    case 'reinhard':
      return ReinhardToneMapping
    case 'cineon':
      return CineonToneMapping
    case 'agx':
      return AgXToneMapping
    case 'aces':
      return ACESFilmicToneMapping
    default:
      return NoToneMapping
  }
}

/** Pós-processo AAA completo (portado de PsxPostProcessing, sem pixel/dither/res scale) */
export function AaaPostProcessing() {
  const { gl, scene, camera, size, viewport } = useThree()
  const post = AAA_CLASSIC.post

  const composerRef = useRef<EffectComposer | null>(null)
  const taaPassRef = useRef<InstanceType<typeof TAARenderPass> | null>(null)
  const renderPassRef = useRef<InstanceType<typeof RenderPass> | null>(null)
  const aoPassRef = useRef<SsaoPassLike | null>(null)
  const rgbSplitPassRef = useRef<ShaderPassLike | null>(null)
  const contactShadowPassRef = useRef<ShaderPassLike | null>(null)
  const screenLightPassRef = useRef<ShaderPassLike | null>(null)
  const bloomFogPassRef = useRef<ShaderPassLike | null>(null)
  const chromaticDirtPassRef = useRef<ShaderPassLike | null>(null)
  const colorGradePassRef = useRef<ShaderPassLike | null>(null)
  const sharpenPassRef = useRef<ShaderPassLike | null>(null)
  const bloomPassRef = useRef<InstanceType<typeof UnrealBloomPass> | null>(null)
  const vignettePassRef = useRef<ShaderPassLike | null>(null)
  const motionBlurPassRef = useRef<ShaderPassLike | null>(null)
  const filmGrainPassRef = useRef<ShaderPassLike | null>(null)
  const bokehPassRef = useRef<InstanceType<typeof BokehPass> | null>(null)

  const prevMbQuatRef = useRef<Quaternion | null>(null)
  const prevMbPosRef = useRef<Vector3 | null>(null)
  const prevCamPosRef = useRef<Vector3 | null>(null)
  const prevCamQuatRef = useRef<Quaternion | null>(null)
  const aoAlphaMeshesRef = useRef<Mesh[]>([])
  const aoAlphaScanCooldownRef = useRef(0)

  const previousToneMappingRef = useRef<ToneMapping | null>(null)
  const previousExposureRef = useRef<number | null>(null)
  const previousShadowMapTypeRef = useRef<ShadowMapType | null>(null)
  const previousOutputColorSpaceRef = useRef<string | null>(null)

  const passes = useMemo(() => createAaaPostShaders(post.colorGrade), [post.colorGrade])

  useEffect(() => {
    previousToneMappingRef.current = gl.toneMapping
    previousExposureRef.current = gl.toneMappingExposure
    previousShadowMapTypeRef.current = gl.shadowMap.type
    previousOutputColorSpaceRef.current = gl.outputColorSpace
    gl.toneMapping = resolveToneMapping(AAA_CLASSIC.color.toneMapping)
    gl.toneMappingExposure = AAA_CLASSIC.color.exposure
    gl.outputColorSpace = SRGBColorSpace
    gl.shadowMap.type = PCFSoftShadowMap

    const renderTarget = new WebGLRenderTarget(size.width, size.height, {
      type: AAA_CLASSIC.renderer.hdr ? HalfFloatType : undefined,
      depthBuffer: true,
      stencilBuffer: false,
    })
    renderTarget.samples = AAA_CLASSIC.renderer.multisampling
    const composer = new EffectComposer(gl, renderTarget)
    const renderPass = new RenderPass(scene, camera)
    const taaPass = new TAARenderPass(scene, camera)
    taaPass.sampleLevel = post.temporalAA.sampleLevel
    taaPass.unbiased = post.temporalAA.unbiased
    taaPass.accumulate = false

    composer.addPass(renderPass)
    composer.addPass(taaPass)

    const aoPass = new SSAOPass(scene, camera, size.width, size.height) as SsaoPassLike
    aoPass.kernelRadius = post.ambientOcclusion.kernelRadius
    aoPass.minDistance = post.ambientOcclusion.minDistance
    aoPass.maxDistance = post.ambientOcclusion.maxDistance
    aoPass.enabled = post.ambientOcclusion.enabled

    const alphaPrevVisible = new WeakMap<Mesh, boolean>()
    const aoOverrideBase = aoPass.overrideVisibility.bind(aoPass)
    const aoRestoreBase = aoPass.restoreVisibility.bind(aoPass)
    aoPass.overrideVisibility = function overrideVisibilityWithAlphaIgnore() {
      aoOverrideBase()
      for (const mesh of aoAlphaMeshesRef.current) {
        alphaPrevVisible.set(mesh, mesh.visible)
        mesh.visible = false
      }
    }
    aoPass.restoreVisibility = function restoreVisibilityWithAlphaIgnore() {
      for (const mesh of aoAlphaMeshesRef.current) {
        const prev = alphaPrevVisible.get(mesh)
        if (prev !== undefined) {
          mesh.visible = prev
          alphaPrevVisible.delete(mesh)
        }
      }
      aoRestoreBase()
    }
    composer.addPass(aoPass)

    const dofCfg = post.depthOfField
    const bokehPass = new BokehPass(scene, camera, {
      focus: dofCfg.focusFallback,
      aperture: dofCfg.aperture,
      maxblur: dofCfg.maxblur,
    })
    bokehPass.enabled = false
    composer.addPass(bokehPass)

    const rgbSplitPass = new ShaderPass(passes.rgbSplitShader)
    rgbSplitPass.enabled = post.rgbShift.enabled
    const contactShadowPass = new ShaderPass(passes.contactShadowShader)
    contactShadowPass.enabled = post.contactShadows.enabled
    const screenLightPass = new ShaderPass(passes.screenSpaceLightShader)
    screenLightPass.enabled = post.screenSpaceLight.enabled
    const bloomFogPass = new ShaderPass(passes.bloomFogShader)
    bloomFogPass.enabled = post.bloomFog.enabled
    const chromaticDirtPass = new ShaderPass(passes.chromaticDirtShader)
    chromaticDirtPass.enabled = post.chromaticDirt.enabled
    const colorGradePass = new ShaderPass(passes.colorGradeShader)
    const bloomPass = new UnrealBloomPass(
      new Vector2(size.width, size.height),
      post.bloom.intensity,
      post.bloom.radius,
      post.bloom.threshold,
    )
    const sharpenPass = new ShaderPass(passes.sharpenShader)
    const vignettePass = new ShaderPass(passes.vignetteShader)
    const motionBlurPass = new ShaderPass(passes.motionBlurShader)
    motionBlurPass.enabled = post.motionBlur.enabled
    const filmGrainPass = new ShaderPass(passes.filmGrainShader)
    filmGrainPass.enabled = post.filmGrain.enabled
    filmGrainPass.uniforms.intensity.value = post.filmGrain.intensity

    composer.addPass(rgbSplitPass)
    composer.addPass(contactShadowPass)
    composer.addPass(screenLightPass)
    composer.addPass(bloomFogPass)
    composer.addPass(chromaticDirtPass)
    composer.addPass(colorGradePass)
    composer.addPass(bloomPass)
    composer.addPass(sharpenPass)
    composer.addPass(vignettePass)
    composer.addPass(motionBlurPass)
    composer.addPass(filmGrainPass)
    // Tone mapping and linear → sRGB conversion must be the final operation.
    composer.addPass(new OutputPass())

    composerRef.current = composer
    renderPassRef.current = renderPass
    taaPassRef.current = taaPass
    aoPassRef.current = aoPass
    rgbSplitPassRef.current = rgbSplitPass
    contactShadowPassRef.current = contactShadowPass
    screenLightPassRef.current = screenLightPass
    bloomFogPassRef.current = bloomFogPass
    chromaticDirtPassRef.current = chromaticDirtPass
    colorGradePassRef.current = colorGradePass
    bloomPassRef.current = bloomPass
    sharpenPassRef.current = sharpenPass
    vignettePassRef.current = vignettePass
    motionBlurPassRef.current = motionBlurPass
    filmGrainPassRef.current = filmGrainPass
    bokehPassRef.current = bokehPass

    const dpr = viewport.dpr ?? gl.getPixelRatio() ?? 1
    const effW = size.width * dpr
    const effH = size.height * dpr
    composer.setPixelRatio(dpr)
    composer.setSize(size.width, size.height)
    bloomFogPass.uniforms.resolution.value.set(effW, effH)
    contactShadowPass.uniforms.resolution.value.set(effW, effH)
    sharpenPass.uniforms.resolution.value.set(effW, effH)

    applyStaticUniforms(post, colorGradePass, bloomPass, vignettePass, rgbSplitPass, contactShadowPass, screenLightPass, bloomFogPass, chromaticDirtPass, sharpenPass)

    return () => {
      if (previousToneMappingRef.current !== null) {
        gl.toneMapping = previousToneMappingRef.current
      }
      if (previousExposureRef.current !== null) {
        gl.toneMappingExposure = previousExposureRef.current
      }
      if (previousShadowMapTypeRef.current !== null) {
        gl.shadowMap.type = previousShadowMapTypeRef.current
      }
      if (previousOutputColorSpaceRef.current !== null) {
        gl.outputColorSpace = previousOutputColorSpaceRef.current
      }
      composer.dispose()
      composerRef.current = null
    }
  }, [gl, scene, camera, passes, size.width, size.height, viewport.dpr, post])

  useLayoutEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    const dpr = viewport.dpr ?? gl.getPixelRatio() ?? 1
    const effW = size.width * dpr
    const effH = size.height * dpr
    composer.setPixelRatio(dpr)
    composer.setSize(size.width, size.height)
    bloomFogPassRef.current?.uniforms.resolution.value.set(effW, effH)
    contactShadowPassRef.current?.uniforms.resolution.value.set(effW, effH)
    sharpenPassRef.current?.uniforms.resolution.value.set(effW, effH)
  }, [gl, size.width, size.height, viewport.dpr])

  useFrame((_, delta) => {
    const composer = composerRef.current
    if (!composer) return

    const taaCfg = post.temporalAA
    const taaPass = taaPassRef.current
    const renderPass = renderPassRef.current
    if (taaPass && renderPass) {
      const taaEnabled = taaCfg.enabled
      const camPos = camera.position
      const camQuat = camera.quaternion
      if (!prevCamPosRef.current) prevCamPosRef.current = camPos.clone()
      if (!prevCamQuatRef.current) prevCamQuatRef.current = camQuat.clone()
      const movePos = prevCamPosRef.current.distanceTo(camPos)
      const moveRot = 1 - Math.abs(prevCamQuatRef.current.dot(camQuat))
      const isMoving =
        movePos > taaCfg.motionPositionThreshold ||
        moveRot > taaCfg.motionRotationThreshold

      taaPass.enabled = taaEnabled
      renderPass.enabled = !taaEnabled
      taaPass.sampleLevel = taaCfg.sampleLevel
      taaPass.unbiased = taaCfg.unbiased
      taaPass.accumulate = taaEnabled && !isMoving
      if (isMoving) {
        taaPass.accumulate = false
      }
      prevCamPosRef.current.copy(camPos)
      prevCamQuatRef.current.copy(camQuat)
    }

    const aoCfg = post.ambientOcclusion
    const aoPass = aoPassRef.current
    if (aoPass) {
      aoPass.enabled = aoCfg.enabled
      aoPass.output = mapAoOutput(aoCfg.output)
      if (aoPass.enabled && aoPass.ssaoMaterial?.uniforms && aoPass.depthRenderMaterial?.uniforms) {
        const u = aoPass.ssaoMaterial.uniforms
        ;(u.cameraProjectionMatrix.value as import('three').Matrix4).copy(camera.projectionMatrix)
        ;(u.cameraInverseProjectionMatrix.value as import('three').Matrix4).copy(
          camera.projectionMatrixInverse,
        )
        ;(u.cameraNear.value as number) = camera.near
        ;(u.cameraFar.value as number) = camera.far
        const du = aoPass.depthRenderMaterial.uniforms
        ;(du.cameraNear.value as number) = camera.near
        ;(du.cameraFar.value as number) = camera.far
      }

      aoAlphaScanCooldownRef.current -= delta
      if (aoAlphaScanCooldownRef.current <= 0) {
        aoAlphaScanCooldownRef.current = aoPass.enabled ? 6 : 2
        if (aoCfg.ignoreAlpha) {
          const alphaMeshes: Mesh[] = []
          scene.traverse((obj) => {
            const mesh = obj as Mesh
            if (!mesh.isMesh || !mesh.geometry) return
            if (meshUsesAlphaMaterial(mesh)) alphaMeshes.push(mesh)
          })
          aoAlphaMeshesRef.current = alphaMeshes
        } else {
          aoAlphaMeshesRef.current = []
        }
      }
    }

    updatePassUniforms(post, rgbSplitPassRef.current, contactShadowPassRef.current, screenLightPassRef.current, bloomFogPassRef.current, chromaticDirtPassRef.current, colorGradePassRef.current, bloomPassRef.current, sharpenPassRef.current, vignettePassRef.current, filmGrainPassRef.current, delta)

    updateMotionBlur(post.motionBlur, motionBlurPassRef.current, camera, prevMbQuatRef, prevMbPosRef)

    const bokehPass = bokehPassRef.current
    if (bokehPass) {
      const strength = getCinematicDofStrength()
      bokehPass.enabled = strength > 0.02
      if (bokehPass.enabled) {
        const dofCfg = post.depthOfField
        const u = bokehPass.uniforms as Record<string, { value: number }>
        u.focus.value = estimateCinematicFocusDistance(camera, dofCfg.focusFallback)
        const aspect = (camera as PerspectiveCamera).aspect
        if (typeof aspect === 'number') u.aspect.value = aspect
        u.aperture.value = dofCfg.aperture * strength
        u.maxblur.value = dofCfg.maxblur * strength
        u.nearClip.value = camera.near
        u.farClip.value = camera.far
      }
    }

    gl.toneMappingExposure = AAA_CLASSIC.color.exposure
    composer.render(delta)
  }, 1)

  return null
}

function applyStaticUniforms(
  post: typeof AAA_CLASSIC.post,
  colorGradePass: ShaderPassLike,
  bloomPass: InstanceType<typeof UnrealBloomPass>,
  vignettePass: ShaderPassLike,
  rgbSplitPass: ShaderPassLike,
  contactShadowPass: ShaderPassLike,
  screenLightPass: ShaderPassLike,
  bloomFogPass: ShaderPassLike,
  chromaticDirtPass: ShaderPassLike,
  sharpenPass: ShaderPassLike,
) {
  const cg = post.colorGrade
  colorGradePass.uniforms.hdrExposure.value = cg.hdrExposure
  colorGradePass.uniforms.saturation.value = cg.saturation
  colorGradePass.uniforms.contrast.value = cg.contrast
  colorGradePass.uniforms.brightness.value = cg.brightness
  colorGradePass.uniforms.gamma.value = cg.gamma
  colorGradePass.uniforms.hueShift.value = cg.hueShift
  colorGradePass.uniforms.colorCorrection.value = [...cg.colorCorrection]
  const multiply = colorGradePass.uniforms.colorMultiply.value as number[]
  const [mr, mg, mb] = hexToRgb01(cg.colorMultiply)
  multiply[0] = mr
  multiply[1] = mg
  multiply[2] = mb
  const tint = colorGradePass.uniforms.tintColor.value as Vector3
  const [tr, tg, tb] = hexToRgb01(cg.tintColor)
  tint.set(tr, tg, tb)
  colorGradePass.uniforms.tintStrength.value = cg.tintStrength

  bloomPass.strength = post.bloom.intensity
  bloomPass.radius = post.bloom.radius
  bloomPass.threshold = post.bloom.threshold
  vignettePass.uniforms.vignette.value = cg.vignette
  rgbSplitPass.uniforms.amount.value = post.rgbShift.amount
  rgbSplitPass.uniforms.angle.value = post.rgbShift.angle
  sharpenPass.uniforms.amount.value = cg.sharpen

  contactShadowPass.uniforms.strength.value = post.contactShadows.strength
  contactShadowPass.uniforms.radius.value = post.contactShadows.radius
  contactShadowPass.uniforms.threshold.value = post.contactShadows.threshold
  contactShadowPass.uniforms.lowerScreenBoost.value = post.contactShadows.lowerScreenBoost

  screenLightPass.uniforms.intensity.value = post.screenSpaceLight.intensity
  screenLightPass.uniforms.threshold.value = post.screenSpaceLight.threshold
  screenLightPass.uniforms.shadowStrength.value = post.screenSpaceLight.shadowStrength
  screenLightPass.uniforms.radius.value = post.screenSpaceLight.radius
  ;(screenLightPass.uniforms.center.value as Vector2).set(
    post.screenSpaceLight.centerX,
    post.screenSpaceLight.centerY,
  )

  const bf = post.bloomFog
  bloomFogPass.uniforms.threshold.value = bf.threshold
  bloomFogPass.uniforms.softKnee.value = bf.softKnee
  bloomFogPass.uniforms.glowStrength.value = bf.glowStrength
  bloomFogPass.uniforms.fogTintMix.value = bf.fogTintMix
  bloomFogPass.uniforms.radiusPx.value = bf.radiusPx
  bloomFogPass.uniforms.outerRadiusMul.value = bf.outerRadiusMul
  bloomFogPass.uniforms.veilStrength.value = bf.veilStrength
  const [fr, fg, fb] = hexToRgb01(bf.fogColor)
  ;(bloomFogPass.uniforms.fogColor.value as Vector3).set(fr, fg, fb)

  const cd = post.chromaticDirt
  chromaticDirtPass.uniforms.amount.value = cd.amount
  chromaticDirtPass.uniforms.radialStrength.value = cd.radialStrength
  chromaticDirtPass.uniforms.dirtStrength.value = cd.dirtStrength
  chromaticDirtPass.uniforms.dirtScale.value = cd.dirtScale
  chromaticDirtPass.uniforms.dirtThreshold.value = cd.dirtThreshold
  ;(chromaticDirtPass.uniforms.center.value as Vector2).set(cd.centerX, cd.centerY)
}

function updatePassUniforms(
  post: typeof AAA_CLASSIC.post,
  rgbSplitPass: ShaderPassLike | null,
  contactShadowPass: ShaderPassLike | null,
  screenLightPass: ShaderPassLike | null,
  bloomFogPass: ShaderPassLike | null,
  chromaticDirtPass: ShaderPassLike | null,
  colorGradePass: ShaderPassLike | null,
  bloomPass: InstanceType<typeof UnrealBloomPass> | null,
  sharpenPass: ShaderPassLike | null,
  vignettePass: ShaderPassLike | null,
  filmGrainPass: ShaderPassLike | null,
  delta: number,
) {
  if (rgbSplitPass) rgbSplitPass.enabled = post.rgbShift.enabled
  if (contactShadowPass) contactShadowPass.enabled = post.contactShadows.enabled
  if (screenLightPass) screenLightPass.enabled = post.screenSpaceLight.enabled
  if (bloomFogPass) bloomFogPass.enabled = post.bloomFog.enabled
  if (chromaticDirtPass) {
    chromaticDirtPass.enabled = post.chromaticDirt.enabled
    chromaticDirtPass.uniforms.time.value += delta
  }
  if (filmGrainPass) {
    filmGrainPass.enabled = post.filmGrain.enabled && post.filmGrain.intensity > 1e-5
    filmGrainPass.uniforms.intensity.value = post.filmGrain.intensity
    filmGrainPass.uniforms.time.value += delta
  }
  if (colorGradePass) {
    colorGradePass.uniforms.brightness.value = post.colorGrade.brightness
  }
  if (bloomPass) {
    bloomPass.strength = post.bloom.intensity
    bloomPass.radius = post.bloom.radius
    bloomPass.threshold = post.bloom.threshold
  }
  if (sharpenPass) sharpenPass.uniforms.amount.value = post.colorGrade.sharpen
  if (vignettePass) vignettePass.uniforms.vignette.value = post.colorGrade.vignette
}

function updateMotionBlur(
  mbCfg: typeof AAA_CLASSIC.post.motionBlur,
  mbPass: ShaderPassLike | null,
  camera: import('three').Camera,
  prevMbQuatRef: MutableRefObject<Quaternion | null>,
  prevMbPosRef: MutableRefObject<Vector3 | null>,
) {
  if (!mbPass) return
  mbPass.enabled = mbCfg.enabled
  if (!mbCfg.enabled) {
    mbPass.uniforms.uMix.value = 0
    return
  }

  if (!prevMbQuatRef.current || !prevMbPosRef.current) {
    prevMbQuatRef.current = new Quaternion().copy(camera.quaternion)
    prevMbPosRef.current = new Vector3().copy(camera.position)
    mbPass.uniforms.uDirNorm.value.set(0, 1)
    mbPass.uniforms.uStepUv.value = 0
    mbPass.uniforms.uMix.value = 0
    return
  }

  _mbDq.copy(prevMbQuatRef.current).invert().multiply(camera.quaternion)
  const w = MathUtils.clamp(_mbDq.w, -1, 1)
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w))
  const angle = 2 * Math.acos(w)
  if (sinHalf > 1e-5) {
    const inv = 1 / sinHalf
    _mbAxis.set(_mbDq.x * inv, _mbDq.y * inv, _mbDq.z * inv)
  } else {
    _mbAxis.set(0, 0, 0)
  }
  _mbAxis.applyQuaternion(_mbInvQ.copy(camera.quaternion).invert())
  _mbBlur.set(_mbAxis.x * angle * mbCfg.rotationScale, _mbAxis.y * angle * mbCfg.rotationScale)
  _mbDpos.copy(camera.position).sub(prevMbPosRef.current)
  _mbDpos.applyQuaternion(_mbInvQ.copy(camera.quaternion).invert())
  _mbBlur.x += _mbDpos.x * mbCfg.translationScale
  _mbBlur.y += _mbDpos.y * mbCfg.translationScale

  const maxUv = mbCfg.maxBlurUv
  const len = _mbBlur.length()
  if (len > 1e-6) {
    const cappedLen = Math.min(len, maxUv)
    const invLen = 1 / len
    mbPass.uniforms.uDirNorm.value.set(_mbBlur.x * invLen, _mbBlur.y * invLen)
    mbPass.uniforms.uStepUv.value = cappedLen * (1 / 3.2)
    mbPass.uniforms.uMix.value = MathUtils.clamp(
      mbCfg.strength * (cappedLen / maxUv) * 1.12,
      0,
      1,
    )
  } else {
    mbPass.uniforms.uDirNorm.value.set(0, 1)
    mbPass.uniforms.uStepUv.value = 0
    mbPass.uniforms.uMix.value = 0
  }

  prevMbQuatRef.current.copy(camera.quaternion)
  prevMbPosRef.current.copy(camera.position)
}

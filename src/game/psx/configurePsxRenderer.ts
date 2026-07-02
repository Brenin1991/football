import * as THREE from 'three'
import { PSX_CLASSIC } from './psxSettings'

const SHADOW_MAP_TYPE: Record<
  (typeof PSX_CLASSIC.shadow.mapType),
  THREE.ShadowMapType
> = {
  basic: THREE.BasicShadowMap,
  pcf: THREE.PCFShadowMap,
  pcfsoft: THREE.PCFSoftShadowMap,
}

/** Renderer — HDR/tone mapping ficam no pós-processo */
export function configurePsxRenderer(renderer: THREE.WebGLRenderer) {
  const { shadow } = PSX_CLASSIC

  renderer.shadowMap.enabled = shadow.enabled
  renderer.shadowMap.type = SHADOW_MAP_TYPE[shadow.mapType]
  renderer.shadowMap.autoUpdate = true
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = THREE.SRGBColorSpace
}

export function configurePsxScene(scene: THREE.Scene) {
  scene.environment = null
  scene.environmentIntensity = 0
}

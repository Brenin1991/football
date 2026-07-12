import * as THREE from 'three'
import type { GraphicsMode } from '../../store/graphicsStore'
import { configurePsxRenderer, configurePsxScene } from '../psx/configurePsxRenderer'
import { AAA_CLASSIC } from './aaaSettings'

export function configureAaaRenderer(renderer: THREE.WebGLRenderer) {
  const { shadow } = AAA_CLASSIC

  renderer.shadowMap.enabled = shadow.enabled
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.shadowMap.autoUpdate = true
  // HDR + tone mapping ficam no pós-processo (AaaCompositeEffect)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = THREE.SRGBColorSpace
}

export function configureAaaScene(scene: THREE.Scene) {
  const { environment } = AAA_CLASSIC
  if (environment.enabled) {
    scene.environmentIntensity = environment.intensity
  } else {
    scene.environment = null
    scene.environmentIntensity = 0
  }
}

export function configureGraphicsRenderer(renderer: THREE.WebGLRenderer, mode: GraphicsMode) {
  if (mode === 'aaa') configureAaaRenderer(renderer)
  else configurePsxRenderer(renderer)
}

export function configureGraphicsScene(scene: THREE.Scene, mode: GraphicsMode) {
  if (mode === 'aaa') configureAaaScene(scene)
  else configurePsxScene(scene)
}

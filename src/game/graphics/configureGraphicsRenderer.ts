import * as THREE from 'three'
import type { GraphicsMode } from '../../store/graphicsStore'
import { configurePsxRenderer, configurePsxScene } from '../psx/configurePsxRenderer'
import { AAA_CLASSIC } from './aaaSettings'

export function configureAaaRenderer(renderer: THREE.WebGLRenderer) {
  const { shadow, toneMapping, toneMappingExposure } = AAA_CLASSIC

  renderer.shadowMap.enabled = shadow.enabled
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.shadowMap.autoUpdate = true
  renderer.toneMapping = toneMapping
  renderer.toneMappingExposure = toneMappingExposure
  renderer.outputColorSpace = THREE.SRGBColorSpace
}

export function configureAaaScene(scene: THREE.Scene) {
  scene.environmentIntensity = AAA_CLASSIC.environment.intensity
}

export function configureGraphicsRenderer(renderer: THREE.WebGLRenderer, mode: GraphicsMode) {
  if (mode === 'aaa') configureAaaRenderer(renderer)
  else configurePsxRenderer(renderer)
}

export function configureGraphicsScene(scene: THREE.Scene, mode: GraphicsMode) {
  if (mode === 'aaa') configureAaaScene(scene)
  else configurePsxScene(scene)
}

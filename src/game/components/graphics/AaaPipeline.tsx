import { Environment } from '@react-three/drei'
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation } from '@react-three/postprocessing'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { AAA_CLASSIC } from '../../graphics/aaaSettings'
import { FIELD_SCALE, SHADOW_CAMERA } from '../../systems/fieldData'

/** Iluminação PBR + IBL + cor viva */
export function AaaPipeline() {
  const { shadow, background, lighting, post, environment } = AAA_CLASSIC
  const sunRef = useRef<THREE.DirectionalLight>(null)

  useLayoutEffect(() => {
    const light = sunRef.current
    if (!light?.shadow) return

    light.shadow.mapSize.setScalar(shadow.mapSize)
    light.shadow.bias = shadow.bias
    light.shadow.normalBias = shadow.normalBias

    const cam = light.shadow.camera as THREE.OrthographicCamera
    cam.left = -SHADOW_CAMERA.halfX
    cam.right = SHADOW_CAMERA.halfX
    cam.top = SHADOW_CAMERA.halfZ
    cam.bottom = -SHADOW_CAMERA.halfZ
    cam.near = SHADOW_CAMERA.near
    cam.far = SHADOW_CAMERA.far
    cam.updateProjectionMatrix()

    const map = light.shadow.map?.texture
    if (map) {
      map.minFilter = THREE.LinearFilter
      map.magFilter = THREE.LinearFilter
      map.needsUpdate = true
    }

    light.shadow.needsUpdate = true
  }, [shadow.bias, shadow.mapSize, shadow.normalBias])

  return (
    <>
      <color attach="background" args={[background]} />
      <Environment preset={environment.preset} environmentIntensity={environment.intensity} />

      <ambientLight intensity={lighting.ambient} />
      <hemisphereLight
        args={[lighting.hemisphereSky, lighting.hemisphereGround, lighting.hemisphereIntensity]}
      />
      <directionalLight
        ref={sunRef}
        position={[18 * FIELD_SCALE, 28 * FIELD_SCALE, 12 * FIELD_SCALE]}
        intensity={lighting.sunIntensity}
        color={lighting.sunColor}
        castShadow={shadow.enabled}
        shadow-mapSize={[shadow.mapSize, shadow.mapSize]}
        shadow-camera-near={SHADOW_CAMERA.near}
        shadow-camera-far={SHADOW_CAMERA.far}
        shadow-camera-left={-SHADOW_CAMERA.halfX}
        shadow-camera-right={SHADOW_CAMERA.halfX}
        shadow-camera-top={SHADOW_CAMERA.halfZ}
        shadow-camera-bottom={-SHADOW_CAMERA.halfZ}
        shadow-bias={shadow.bias}
        shadow-normalBias={shadow.normalBias}
      />
      <directionalLight
        position={[-14 * FIELD_SCALE, 16 * FIELD_SCALE, -8 * FIELD_SCALE]}
        intensity={lighting.fillIntensity}
        color={lighting.fillColor}
      />

      <EffectComposer multisampling={post.multisampling}>
        <HueSaturation saturation={post.saturation} />
        <BrightnessContrast brightness={post.brightness} contrast={post.contrast} />
        <Bloom
          intensity={post.bloomIntensity}
          luminanceThreshold={post.bloomThreshold}
          luminanceSmoothing={post.bloomSmoothing}
          mipmapBlur
        />
      </EffectComposer>
    </>
  )
}

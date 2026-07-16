import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { PsxCompositeEffect } from '../../psx/PsxCompositeEffect'
import { updatePsxShaderTime } from '../../psx/psxMaterial'
import { PSX_CLASSIC } from '../../psx/psxSettings'
import { FIELD_SCALE, SHADOW_CAMERA, fitDirectionalLightShadowToField } from '../../systems/fieldData'
// @ts-ignore: three example loader types not present
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader'
import { CubeCamera } from '@react-three/drei'
import { useGameStore } from '../../store/gameStore'

function PsxEffectPass() {
  const effect = useMemo(() => new PsxCompositeEffect(), [])
  return <primitive object={effect} />
}

/** Iluminação + pós-processamento estilo PSX */
export function PsxPipeline() {
  const { shadow, background, post } = PSX_CLASSIC
  const lightRef = useRef<THREE.DirectionalLight>(null)
  const exr = useLoader(EXRLoader, '/ambient/sky4.exr')
  const { gl, scene } = useThree()
  const fieldBounds = useGameStore((s) => s.fieldBounds)

  useEffect(() => {
    if (!exr || !gl) return
    exr.mapping = THREE.EquirectangularReflectionMapping
    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    const envRT = pmrem.fromEquirectangular(exr)
    scene.environment = envRT.texture
    // keep the original EXR as background for higher fidelity
    scene.background = exr
    pmrem.dispose()
    return () => {
      // do not dispose scene.environment since it may be reused
    }
  }, [exr, gl, scene])

  useFrame((state) => {
    updatePsxShaderTime(state.clock.elapsedTime)

    if (!shadow.nearestFilter) return
    const target = lightRef.current?.shadow?.map
    const texture = target?.texture
    if (!texture) return
    if (texture.minFilter === THREE.NearestFilter) return
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.needsUpdate = true
  })

  // Ensure the directional light targets the field center so the shadow
  // orthographic camera covers the whole pitch instead of only center.
  useEffect(() => {
    const light = lightRef.current
    if (!light) return
    const fieldArea = (scene as THREE.Scene).getObjectByName('field_area')
    if (fieldArea) {
      const pos = new THREE.Vector3()
      fieldArea.getWorldPosition(pos)
      light.target.position.copy(pos)
      scene.add(light.target)
      light.target.updateMatrixWorld()
    } else {
      light.target.position.set(0, 0, 0)
      scene.add(light.target)
    }
  }, [scene, fieldBounds])

  // Configure shadow camera extents and map size to cover the whole pitch
  useLayoutEffect(() => {
    const light = lightRef.current
    if (!light || !light.shadow) return
    light.shadow.mapSize.set(shadow.mapSize, shadow.mapSize)
    light.shadow.bias = shadow.bias
    light.shadow.normalBias = shadow.normalBias

    fitDirectionalLightShadowToField(light, scene, 1.55)

    const map = light.shadow.map?.texture
    if (map) {
      map.minFilter = THREE.NearestFilter
      map.magFilter = THREE.NearestFilter
      map.needsUpdate = true
    }
  }, [shadow.mapSize, shadow.bias, shadow.normalBias, scene, fieldBounds])

  return (
    <>
      <color attach="background" args={[background]} />
      <ambientLight color="#a2a96b" intensity={0.58} />
      <hemisphereLight args={['#a8c4e0', '#3a5a40', 0.28]} />
      <directionalLight
        ref={lightRef}
        position={[18 * FIELD_SCALE, 28 * FIELD_SCALE, 12 * FIELD_SCALE]}
        intensity={1}
        color="#fae2b4"
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

      <EffectComposer multisampling={0}>
          <PsxEffectPass />
          <Bloom
            intensity={post.bloom.intensity}
            luminanceThreshold={post.bloom.threshold}
            luminanceSmoothing={post.bloom.smoothing}
            radius={post.bloom.radius}
            mipmapBlur={post.bloom.mipmapBlur}
          />
        {/* Reflection probe: capture environment for dynamic reflections (updates once) */}
        <CubeCamera frames={1} resolution={256} position={[0, 1.5, 0]}>
          {(texture) => <SetReflection texture={texture} />}
        </CubeCamera>
      </EffectComposer>
    </>
  )
}

function SetReflection({ texture }: { texture: THREE.Texture | null }) {
  const { scene } = useThree()
  useEffect(() => {
    if (!texture) return
    scene.environment = texture
  }, [texture, scene])
  return null
}

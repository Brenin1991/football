import { CubeCamera } from '@react-three/drei'
import { useLoader, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { AAA_CLASSIC } from '../../graphics/aaaSettings'
import { AaaPostProcessing } from './AaaPostProcessing'
import { FIELD_SCALE, fitDirectionalLightShadowToField } from '../../systems/fieldData'
// @ts-ignore: three example loader types not present
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader'
import { useGameStore } from '../../store/gameStore'

function SetReflection({ texture }: { texture: THREE.Texture | null }) {
  const { scene } = useThree()
  const { environment, reflectionProbe } = AAA_CLASSIC

  useEffect(() => {
    if (!texture || !reflectionProbe.enabled) return
    scene.environment = texture
    scene.environmentIntensity = environment.intensity
  }, [texture, scene, environment.intensity, reflectionProbe.enabled])

  return null
}

/** Iluminação PBR + sky EXR + reflection probe + pós-processamento */
export function AaaPipeline() {
  const { shadow, background, lighting, environment, reflectionProbe } = AAA_CLASSIC
  const sunRef = useRef<THREE.DirectionalLight>(null)
  const exr = useLoader(EXRLoader, '/ambient/sky5.exr')
  const { gl, scene } = useThree()
  const [probeCenter, setProbeCenter] = useState<[number, number, number]>([0, reflectionProbe.height, 0])
  const fieldBounds = useGameStore((s) => s.fieldBounds)

  useEffect(() => {
    if (!exr || !gl || !environment.enabled) return

    exr.mapping = THREE.EquirectangularReflectionMapping
    scene.background = exr

    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    const envRT = pmrem.fromEquirectangular(exr)
    scene.environment = envRT.texture
    scene.environmentIntensity = environment.intensity
    pmrem.dispose()

    return () => {
      envRT.dispose()
      scene.environment = null
      scene.background = null
    }
  }, [exr, gl, scene, environment.enabled, environment.intensity])

  useEffect(() => {
    const fieldArea = scene.getObjectByName('field_area')
    if (fieldArea) {
      const pos = new THREE.Vector3()
      fieldArea.getWorldPosition(pos)
      setProbeCenter([pos.x, pos.y + reflectionProbe.height, pos.z])
    } else {
      setProbeCenter([0, reflectionProbe.height, 0])
    }
  }, [scene, reflectionProbe.height, fieldBounds])

  useEffect(() => {
    const light = sunRef.current
    if (!light) return

    const fieldArea = scene.getObjectByName('field_area')
    if (fieldArea) {
      const pos = new THREE.Vector3()
      fieldArea.getWorldPosition(pos)
      light.target.position.copy(pos)
    } else {
      light.target.position.set(0, 0, 0)
    }
    scene.add(light.target)
    light.target.updateMatrixWorld()
  }, [scene, fieldBounds])

  /**
   * Shadow camera SÓ via fit imperativo.
   * Não usar shadow-camera-* no JSX — o R3F reaplica a cada render e
   * corta o frustum de volta pro tamanho do gramado (arquibancadas ficam de fora).
   */
  useLayoutEffect(() => {
    const light = sunRef.current
    if (!light?.shadow) return

    const maxTex = gl.capabilities.maxTextureSize || 4096
    const mapSize = Math.min(shadow.mapSize, maxTex)
    if (light.shadow.mapSize.x !== mapSize) {
      light.shadow.mapSize.set(mapSize, mapSize)
      // força recriar o render target no tamanho novo
      if (light.shadow.map) {
        light.shadow.map.dispose()
        ;(light.shadow as { map: THREE.WebGLRenderTarget | null }).map = null
      }
    }
    light.shadow.bias = shadow.bias
    light.shadow.normalBias = shadow.normalBias

    fitDirectionalLightShadowToField(light, scene, 1.12)

    const map = light.shadow.map?.texture
    if (map) {
      map.minFilter = THREE.LinearFilter
      map.magFilter = THREE.LinearFilter
      map.needsUpdate = true
    }

    light.shadow.needsUpdate = true
  }, [gl, shadow.bias, shadow.mapSize, shadow.normalBias, scene, fieldBounds])

  return (
    <>
      <color attach="background" args={[background]} />

      <ambientLight intensity={lighting.ambient} />
      <hemisphereLight
        args={[lighting.hemisphereSky, lighting.hemisphereGround, lighting.hemisphereIntensity]}
      />
      <directionalLight
        ref={sunRef}
        position={[64 * FIELD_SCALE, 32 * FIELD_SCALE, 64 * FIELD_SCALE]}
        intensity={lighting.sunIntensity}
        color={lighting.sunColor}
        castShadow={shadow.enabled}
        shadow-mapSize={[
          Math.min(shadow.mapSize, gl.capabilities.maxTextureSize || 4096),
          Math.min(shadow.mapSize, gl.capabilities.maxTextureSize || 4096),
        ]}
        shadow-bias={shadow.bias}
        shadow-normalBias={shadow.normalBias}
      />
      <directionalLight
        position={[14 * FIELD_SCALE, 12 * FIELD_SCALE, 8 * FIELD_SCALE]}
        intensity={lighting.fillIntensity}
        color={lighting.fillColor}
      />

      {reflectionProbe.enabled && (
        <CubeCamera
          key={`${probeCenter[0].toFixed(2)}:${probeCenter[1].toFixed(2)}:${probeCenter[2].toFixed(2)}`}
          frames={reflectionProbe.frames}
          resolution={reflectionProbe.resolution}
          position={probeCenter}
        >
          {(texture) => <SetReflection texture={texture} />}
        </CubeCamera>
      )}

      <AaaPostProcessing />
    </>
  )
}

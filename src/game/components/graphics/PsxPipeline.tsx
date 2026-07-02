import { EffectComposer } from '@react-three/postprocessing'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { PsxCompositeEffect } from '../../psx/PsxCompositeEffect'
import { updatePsxShaderTime } from '../../psx/psxMaterial'
import { PSX_CLASSIC } from '../../psx/psxSettings'
import { FIELD_SCALE } from '../../systems/fieldData'

function PsxEffectPass() {
  const effect = useMemo(() => new PsxCompositeEffect(), [])
  return <primitive object={effect} />
}

/** Iluminação + pós-processamento estilo PSX */
export function PsxPipeline() {
  const { shadow, background } = PSX_CLASSIC
  const lightRef = useRef<THREE.DirectionalLight>(null)

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

  return (
    <>
      <color attach="background" args={[background]} />
      <ambientLight color="#8899aa" intensity={0.58} />
      <hemisphereLight args={['#a8c4e0', '#3a5a40', 0.28]} />
      <directionalLight
        ref={lightRef}
        position={[18 * FIELD_SCALE, 28 * FIELD_SCALE, 12 * FIELD_SCALE]}
        intensity={1.05}
        color="#fff4e0"
        castShadow={shadow.enabled}
        shadow-mapSize={[shadow.mapSize, shadow.mapSize]}
        shadow-camera-far={80 * FIELD_SCALE}
        shadow-camera-left={-24 * FIELD_SCALE}
        shadow-camera-right={24 * FIELD_SCALE}
        shadow-camera-top={24 * FIELD_SCALE}
        shadow-camera-bottom={-24 * FIELD_SCALE}
        shadow-bias={shadow.bias}
        shadow-normalBias={shadow.normalBias}
      />

      <EffectComposer multisampling={0}>
        <PsxEffectPass />
      </EffectComposer>
    </>
  )
}

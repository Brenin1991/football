import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { getPitchGroundY } from '../systems/fieldData'
import { replaySystem } from '../systems/replaySystem'

const LINE_COLOR = '#00e5ff'
const BAND_COLOR = '#38bdf8'

export function OffsideReplayLine() {
  const phase = useGameStore((s) => s.phase)
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const groupRef = useRef<THREE.Group>(null)
  const bandMat = useRef<THREE.MeshBasicMaterial>(null)
  const lineMat = useRef<THREE.MeshBasicMaterial>(null)
  const [, replayTick] = useState(0)

  useEffect(() => {
    if (phase !== 'replay') return
    const id = window.setInterval(() => replayTick((n) => n + 1), 40)
    return () => window.clearInterval(id)
  }, [phase])

  const layout = useMemo(() => {
    if (!fieldBounds) return null
    const lineZ = replaySystem.getOffsideLineZ()
    if (lineZ == null) return null
    const y = getPitchGroundY() + 0.09
    const width = fieldBounds.maxX - fieldBounds.minX - 0.2
    return {
      y,
      width,
      cx: fieldBounds.center.x,
      z: lineZ,
    }
  }, [fieldBounds, phase, replayTick])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const show =
      useGameStore.getState().phase === 'replay' &&
      replaySystem.getEventType() === 'offside' &&
      replaySystem.getOffsideLineZ() != null &&
      replaySystem.isActive()

    group.visible = show
    if (!show) return

    const progress = replaySystem.getPlaybackProgress()
    const fadeIn = Math.min(1, progress * 3.5)
    const pulse = 0.78 + Math.sin(performance.now() * 0.005) * 0.14

    if (bandMat.current) {
      bandMat.current.opacity = fadeIn * pulse * 0.28
    }
    if (lineMat.current) {
      lineMat.current.opacity = fadeIn * pulse * 0.98
    }
  })

  if (phase !== 'replay' || !layout) return null

  return (
    <group ref={groupRef} visible={false}>
      <mesh
        position={[layout.cx, layout.y, layout.z]}
        renderOrder={2000}
        frustumCulled={false}
      >
        <boxGeometry args={[layout.width, 0.015, 0.52]} />
        <meshBasicMaterial
          ref={bandMat}
          color={BAND_COLOR}
          transparent
          opacity={0.28}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        position={[layout.cx, layout.y + 0.008, layout.z]}
        renderOrder={2001}
        frustumCulled={false}
      >
        <boxGeometry args={[layout.width, 0.012, 0.09]} />
        <meshBasicMaterial
          ref={lineMat}
          color={LINE_COLOR}
          transparent
          opacity={0.98}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

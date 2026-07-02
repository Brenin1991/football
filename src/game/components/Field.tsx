import { useGLTF } from '@react-three/drei'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { applyFieldGraphics } from '../psx/psxMaterials'
import {
  extractFieldData,
  FIELD_SCALE,
  getPitchCollider,
  hideDebugNodes,
} from '../systems/fieldData'
import { beginMatchIntro } from '../systems/matchIntro'

useGLTF.preload('/models/field.glb')

export function Field() {
  const { scene } = useGLTF('/models/field.glb')
  const setFieldData = useGameStore((s) => s.setFieldData)
  const cloned = useMemo(() => scene.clone(true), [scene])
  const [collider, setCollider] = useState(getPitchCollider)
  const introStartedRef = useRef(false)

  useEffect(() => {
    hideDebugNodes(cloned)
    cloned.scale.set(FIELD_SCALE, 1, FIELD_SCALE)
    cloned.updateMatrixWorld(true)
    applyFieldGraphics(cloned)
    const { bounds, goals, spawn, collider: pitchCollider } = extractFieldData(cloned)
    setFieldData(bounds, goals)
    setCollider(pitchCollider)
    if (!introStartedRef.current) {
      introStartedRef.current = true
      beginMatchIntro(bounds, spawn)
    }
  }, [cloned, setFieldData])

  return (
    <group>
      <primitive object={cloned} />
      <RigidBody type="fixed" colliders={false} friction={0.82} restitution={0.28}>
        <CuboidCollider
          args={collider.halfExtents}
          position={collider.position}
        />
      </RigidBody>
    </group>
  )
}

import { useGLTF } from '@react-three/drei'
import { CuboidCollider, CoefficientCombineRule, RigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { applyFieldGraphics } from '../graphics/graphicsMaterials'
import {
  extractFieldData,
  FIELD_SCALE,
  getPitchCollider,
  hideDebugNodes,
  showDebugNodes,
  stripFieldHelperNodes,
} from '../systems/fieldData'
import { PHYSICS_DEBUG } from '../constants'
import { beginMatchIntro } from '../systems/matchIntro'
import { ballRef } from '../systems/entityRegistry'
import { sfx } from '../systems/sfx'
import { FieldLightPointFlares } from './FieldLightPointFlares'
import { FieldStadiumCrowd } from './FieldStadiumCrowd'

useGLTF.preload('/models/field.glb')

export function Field() {
  const { scene } = useGLTF('/models/field.glb')
  const setFieldData = useGameStore((s) => s.setFieldData)
  const cloned = useMemo(() => {
    const root = scene.clone(true)
    root.name = 'field_stadium'
    return root
  }, [scene])
  const [collider, setCollider] = useState(getPitchCollider)
  const [goalColliders, setGoalColliders] = useState<
    import('../systems/fieldData').GoalFrameCollider[]
  >([])
  const introStartedRef = useRef(false)

  useEffect(() => {
    if (PHYSICS_DEBUG) showDebugNodes(cloned)
    else hideDebugNodes(cloned)
    cloned.scale.set(FIELD_SCALE, 1, FIELD_SCALE)
    cloned.updateMatrixWorld(true)
    applyFieldGraphics(cloned)
    const { bounds, goals, goalColliders: frames, spawn, collider: pitchCollider } =
      extractFieldData(cloned)
    // Fora do debug: remove helpers (ball_spawn / círculo) do grafo da cena
    if (!PHYSICS_DEBUG) stripFieldHelperNodes(cloned)
    setFieldData(bounds, goals, { pitch: pitchCollider, frames })
    setCollider(pitchCollider)
    setGoalColliders(frames)
    if (!introStartedRef.current) {
      introStartedRef.current = true
      // Espera o RigidBody da bola existir (evita race no 1º mount / HMR)
      queueMicrotask(() => beginMatchIntro(bounds, spawn))
    }
  }, [cloned, setFieldData])

  return (
    <group>
      <primitive object={cloned} />
      <FieldLightPointFlares mapScene={cloned} />
      <FieldStadiumCrowd mapScene={cloned} />
      <RigidBody type="fixed" colliders={false} friction={0.82} restitution={0.28}>
        <CuboidCollider
          args={collider.halfExtents}
          position={collider.position}
        />
      </RigidBody>
      {goalColliders.map((frame, i) => (
        <RigidBody
          key={`${frame.part}-${i}`}
          type="fixed"
          colliders={false}
          userData={{ isGoalFrame: true, part: frame.part }}
        >
          <CuboidCollider
            args={frame.halfExtents}
            position={frame.position}
            friction={frame.friction}
            restitution={frame.restitution}
            restitutionCombineRule={CoefficientCombineRule.Max}
            frictionCombineRule={CoefficientCombineRule.Min}
            onCollisionEnter={(e) => {
              const other = e.other.rigidBodyObject
              if (!other?.userData?.isBall) return
              const vel = ballRef.velocity
              const speed = Math.hypot(vel.x, vel.y, vel.z)
              if (speed < 1.2) return
              sfx.playPost(Math.min(1, speed / 14))
            }}
          />
        </RigidBody>
      ))}
    </group>
  )
}

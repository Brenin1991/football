import { useAnimations } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { PLAYER_HEIGHT } from '../constants'
import { usePlayerAssets } from '../context/PlayerAssetsContext'
import type { PlayerAnim } from '../types'
import { entranceSystem } from '../systems/teamEntrance'
import { isFieldParadePhase } from '../systems/matchPhases'
import { useGameStore } from '../store/gameStore'
import { refereeState } from '../systems/referee'
import { getPlayerBodyY } from '../systems/fieldData'
import { getSimDelta } from '../systems/gameTime'
import { distance2D } from '../systems/rules'

import { applyRefereeMaterials } from '../psx/psxMaterials'
import { alignPlayerModelToCapsule } from '../systems/animationClips'

const LOCOMOTION_ANIMS: PlayerAnim[] = ['idle', 'run']

export function Referee() {
  const { scene, animations } = usePlayerAssets()
  const rootRef = useRef<THREE.Group>(null)
  const modelRootRef = useRef<THREE.Group>(null)
  const pos = useRef({ x: 2.8, z: -2.4 })
  const rot = useRef(0)

  const cloned = useMemo(() => {
    const model = SkeletonUtils.clone(scene) as THREE.Group
    applyRefereeMaterials(model)
    alignPlayerModelToCapsule(model)
    return model
  }, [scene])

  const { actions, mixer } = useAnimations(animations, modelRootRef)
  const currentAnim = useRef<PlayerAnim>('idle')

  useEffect(() => {
    if (!actions.idle) return
    for (const action of Object.values(actions)) {
      if (!action) continue
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.clampWhenFinished = false
      action.enabled = true
    }
    actions.idle.reset().fadeIn(0.2).play()
    currentAnim.current = 'idle'
  }, [actions])

  const playAnim = (name: PlayerAnim) => {
    if (currentAnim.current === name) return
    const next = actions[name]
    const prev = actions[currentAnim.current]
    if (!next) return

    const bothLoco =
      LOCOMOTION_ANIMS.includes(name) && LOCOMOTION_ANIMS.includes(currentAnim.current)

    if (!bothLoco) next.reset()

    next.enabled = true
    if (prev && prev !== next) {
      prev.enabled = true
      if (!prev.isRunning()) prev.play()
      next.play()
      prev.crossFadeTo(next, 0.28, bothLoco)
    } else {
      next.play()
      next.setEffectiveWeight(1)
    }

    for (const action of Object.values(actions)) {
      if (!action || action === next || action === prev) continue
      action.stop()
    }

    currentAnim.current = name
  }

  useFrame((_, delta) => {
    const simDelta = getSimDelta(delta)
    mixer?.update(simDelta)

    const phase = useGameStore.getState().phase

    if (isFieldParadePhase(phase)) {
      const actor = entranceSystem.getRefereeState()
      if (actor) {
        pos.current.x = actor.x
        pos.current.z = actor.z
        rot.current = actor.rotation
        playAnim(actor.moving ? 'run' : 'idle')
      }
      if (rootRef.current) {
        rootRef.current.position.set(pos.current.x, getPlayerBodyY(), pos.current.z)
      }
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rot.current
      }
      return
    }

    const targetX = refereeState.targetX
    const targetZ = refereeState.targetZ
    const dist = distance2D(
      { x: pos.current.x, y: 0, z: pos.current.z },
      { x: targetX, y: 0, z: targetZ },
    )

    if (dist > 0.15) {
      const dx = targetX - pos.current.x
      const dz = targetZ - pos.current.z
      rot.current = Math.atan2(dx, dz)
      const speed = 4.2
      const step = Math.min(dist, speed * simDelta)
      const len = Math.hypot(dx, dz) || 1
      pos.current.x += (dx / len) * step
      pos.current.z += (dz / len) * step
      playAnim('run')
    } else {
      playAnim('idle')
    }

    if (rootRef.current) {
      rootRef.current.position.set(pos.current.x, getPlayerBodyY(), pos.current.z)
    }
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y = rot.current
    }
  })

  const cardColor =
    refereeState.showingCard === 'yellow'
      ? '#facc15'
      : refereeState.showingCard === 'red'
        ? '#ef4444'
        : null

  return (
    <group ref={rootRef} position={[2.8, getPlayerBodyY(), -2.4]}>
      <primitive ref={modelRootRef} object={cloned} />
      {cardColor && (
        <mesh position={[0.35, PLAYER_HEIGHT * 0.22, 0.12]} rotation={[0, rot.current, -0.25]}>
          <boxGeometry args={[0.22, 0.32, 0.02]} />
          <meshBasicMaterial color={cardColor} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

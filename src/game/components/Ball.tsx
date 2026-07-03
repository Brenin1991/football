import { BallCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { createBallMaterial } from '../graphics/graphicsMaterials'
import { useFrame } from '@react-three/fiber'
import {
  BALL_ANGULAR_DAMPING,
  BALL_FRICTION,
  BALL_LINEAR_DAMPING,
  BALL_MASS,
  BALL_RADIUS,
  BALL_RESTITUTION,
} from '../constants'
import { useGameStore } from '../store/gameStore'
import { ballBodyRef, ballRef, playerRegistry } from '../systems/entityRegistry'
import {
  clearDribbleState,
  syncDribblePossession,
  updatePossessedBall,
} from '../systems/ballDribble'
import { ensureBallKinematic, isSetPieceLaunchActive, syncBallFromBody } from '../systems/ballPhysics'
import { getSimDelta } from '../systems/gameTime'
import { ballRestY } from '../systems/fieldData'
import { isActiveSetPiecePhase } from '../systems/setPiece'

function isSetPiecePhase(phase: string) {
  return isActiveSetPiecePhase(phase)
}

export function Ball() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const restY = ballRestY(BALL_RADIUS)
  const ballMaterial = useMemo(() => createBallMaterial(), [])

  useEffect(() => {
    if (bodyRef.current) ballBodyRef.current = bodyRef.current
  }, [])

  useFrame((_, delta) => {
    if (!bodyRef.current) return

    const simDelta = getSimDelta(delta)
    const store = useGameStore.getState()
    if (store.phase === 'replay' || store.phase === 'goal-celebration') return

    const possessed = store.ballPossession
    const frozen = store.ballFrozen

    if (isSetPieceLaunchActive()) {
      if (bodyRef.current.bodyType() !== 0) {
        bodyRef.current.setBodyType(0, true)
      }
      syncBallFromBody(bodyRef.current)
      return
    }

    const setPieceWait =
      frozen && isSetPiecePhase(store.phase) && store.setPiecePosition

    if (setPieceWait) {
      ensureBallKinematic()
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)
      const pos = {
        x: store.setPiecePosition!.x,
        y: restY,
        z: store.setPiecePosition!.z,
      }
      bodyRef.current.setTranslation(pos, true)
      ballRef.current = pos
      ballRef.velocity = { x: 0, y: 0, z: 0 }
      return
    }

    if (possessed || frozen) {
      ensureBallKinematic()
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

      if (possessed) {
        const holder = playerRegistry.get(possessed.playerId)
        if (holder) {
          syncDribblePossession(possessed.playerId, store.possessionSince)
          if (simDelta > 0) {
            updatePossessedBall(bodyRef.current, holder, simDelta, restY)
          }
          return
        }
      }

      const fallback = store.setPiecePosition ?? store.fieldBounds?.center
      if (fallback) {
        const pos = { x: fallback.x, y: restY, z: fallback.z }
        bodyRef.current.setTranslation(pos, true)
        ballRef.current = pos
        ballRef.velocity = { x: 0, y: 0, z: 0 }
      }
      return
    }

    clearDribbleState()

    if (bodyRef.current.bodyType() !== 0) {
      bodyRef.current.setBodyType(0, true)
    }
    syncBallFromBody(bodyRef.current)
  }, 50)

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      mass={BALL_MASS}
      linearDamping={BALL_LINEAR_DAMPING}
      angularDamping={BALL_ANGULAR_DAMPING}
      friction={BALL_FRICTION}
      restitution={BALL_RESTITUTION}
      ccd
      canSleep={false}
      position={[0, restY, 0]}
    >
      <BallCollider
        args={[BALL_RADIUS]}
        friction={BALL_FRICTION}
        restitution={BALL_RESTITUTION}
      />
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[BALL_RADIUS, 36, 36]} />
        <primitive object={ballMaterial} attach="material" />
      </mesh>
    </RigidBody>
  )
}

import { BallCollider, CoefficientCombineRule, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { createBallMaterial } from '../graphics/graphicsMaterials'
import { useFrame, useLoader } from '@react-three/fiber'
import { TextureLoader } from 'three'
import {
  BALL_ANGULAR_DAMPING,
  BALL_FRICTION,
  BALL_LINEAR_DAMPING,
  BALL_MASS,
  BALL_RADIUS,
  BALL_RESTITUTION,
  PHYSICAL_POSSESSION,
  PHYSICS_DEBUG,
} from '../constants'
import { useGameStore } from '../store/gameStore'
import { ballBodyRef, ballRef, playerRegistry } from '../systems/entityRegistry'
import {
  clearDribbleState,
  checkPhysicalPossessionLeash,
  syncDribblePossession,
  updatePhysicalPossessedBall,
  updatePossessedBall,
} from '../systems/ballDribble'
import { updateGkHeldBall } from '../systems/gkBallHold'
import { updateGkHandPositions } from '../systems/goalkeeperHands'
import { getGkRuntime } from '../systems/goalkeeper'
import {
  ensureBallDynamic,
  ensureBallKinematic,
  isSetPieceLaunchActive,
  syncBallFromBody,
  tickBallGroundRoll,
} from '../systems/ballPhysics'
import { getSimDelta } from '../systems/gameTime'
import { ballRestY } from '../systems/fieldData'
import { isActiveSetPiecePhase } from '../systems/setPiece'

function isSetPiecePhase(phase: string) {
  return isActiveSetPiecePhase(phase)
}

export function Ball() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const restY = ballRestY(BALL_RADIUS)

  // Ajuste o caminho pro seu asset real (public/textures/ball.png, por ex.).
  // Como a esfera usa UV equirretangular por padrão, qualquer textura de bola
  // desenhada nesse formato encaixa sem unwrap manual.
  const ballTexture = useLoader(TextureLoader, '/textures/ball.jpg')
  const ballMaterial = useMemo(() => createBallMaterial(ballTexture), [ballTexture])

  useEffect(() => {
    if (bodyRef.current) ballBodyRef.current = bodyRef.current
  }, [])

  useFrame((_, delta) => {
    if (!bodyRef.current) return

    const simDelta = getSimDelta(delta)
    const store = useGameStore.getState()
    if (store.phase === 'replay') return

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
      if (
        store.phase === 'throw-in' &&
        store.setPieceKickerId &&
        simDelta > 0
      ) {
        ensureBallKinematic()
        updateGkHandPositions(store.setPieceKickerId)
        updateGkHeldBall(bodyRef.current, store.setPieceKickerId, simDelta)
        return
      }

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
      if (possessed) {
        const holder = playerRegistry.get(possessed.playerId)
        if (holder) {
          syncDribblePossession(possessed.playerId, store.possessionSince)
          const gkRt =
            holder.role === 'gk' ? getGkRuntime(possessed.playerId) : null
          const gkHandsOnly =
            holder.role === 'gk' &&
            (gkRt?.mode === 'hold' || gkRt?.mode === 'distribute')
          const usePhysical =
            PHYSICAL_POSSESSION && !gkHandsOnly && !frozen && simDelta > 0

          if (usePhysical) {
            ensureBallDynamic()
            updatePhysicalPossessedBall(
              bodyRef.current,
              holder,
              simDelta,
              restY,
            )
            checkPhysicalPossessionLeash(possessed.playerId)
            return
          }

          ensureBallKinematic()
          bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
          bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

          if (simDelta > 0) {
            if (gkHandsOnly) {
              updateGkHeldBall(bodyRef.current, possessed.playerId, simDelta)
            } else {
              updatePossessedBall(bodyRef.current, holder, simDelta, restY)
            }
          }
          return
        }
      }

      ensureBallKinematic()
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

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
    bodyRef.current.wakeUp()
    syncBallFromBody(bodyRef.current)
    if (simDelta > 0) {
      tickBallGroundRoll(bodyRef.current, simDelta)
    }
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
      canSleep
      position={[0, restY, 0]}
      userData={{ isBall: true }}
    >
      <BallCollider
        args={[BALL_RADIUS]}
        friction={BALL_FRICTION}
        restitution={BALL_RESTITUTION}
        restitutionCombineRule={CoefficientCombineRule.Max}
      />
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[BALL_RADIUS, 36, 36]} />
        <primitive object={ballMaterial} attach="material" />
      </mesh>
      {PHYSICS_DEBUG && (
        <mesh renderOrder={1000}>
          <sphereGeometry args={[BALL_RADIUS, 14, 14]} />
          <meshBasicMaterial
            color="#ffffff"
            wireframe
            transparent
            opacity={0.95}
            depthTest={false}
          />
        </mesh>
      )}
    </RigidBody>
  )
}
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
  PHYSICS_DEBUG,
} from '../constants'
import { useGameStore } from '../store/gameStore'
import { ballBodyRef, ballRef, playerRegistry } from '../systems/entityRegistry'
import { updateGkHandPositions } from '../systems/goalkeeperHands'
import {
  ensureBallKinematic,
  isSetPieceLaunchActive,
  syncBallFromBody,
} from '../systems/ballPhysics'
import { ballRestY } from '../systems/fieldData'
import { isActiveSetPiecePhase } from '../systems/setPiece'
import { getBallAtFeet } from '../systems/possession'

function isSetPiecePhase(phase: string) {
  return isActiveSetPiecePhase(phase)
}

function shouldPinFrozenBall(
  phase: string,
  frozen: boolean,
  setPiecePosition: { x: number; z: number } | null,
) {
  if (!frozen || !setPiecePosition) return false
  return (
    isSetPiecePhase(phase) ||
    phase === 'kickoff' ||
    phase === 'intro'
  )
}

export function Ball() {
  const bodyRef = useRef<RapierRigidBody>(null)

  const ballTexture = useLoader(TextureLoader, '/textures/ball.jpg')
  const ballMaterial = useMemo(() => createBallMaterial(ballTexture), [ballTexture])

  // Mantém a ref global alinhada ao body vivo (e limpa no unmount / remount)
  useEffect(() => {
    const body = bodyRef.current
    if (body) ballBodyRef.current = body
    return () => {
      if (ballBodyRef.current === body || ballBodyRef.current === bodyRef.current) {
        ballBodyRef.current = null
      }
    }
  })

  useFrame(() => {
    const body = bodyRef.current
    if (!body) return
    ballBodyRef.current = body

    const store = useGameStore.getState()
    if (store.phase === 'replay') return

    if (isSetPieceLaunchActive()) {
      syncBallFromBody(body)
      return
    }

    const frozen = store.ballFrozen
    const pinBall = shouldPinFrozenBall(store.phase, frozen, store.setPiecePosition)

    if (!pinBall) return

    if (store.phase === 'throw-in' && store.setPieceKickerId) {
      ensureBallKinematic()
      updateGkHandPositions(store.setPieceKickerId)
      return
    }

    const restY = ballRestY(BALL_RADIUS)
    ensureBallKinematic()
    try {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)

      // Kickoff: bola nos pés do cobrador (domínio), não solta no centro
      let pinX = store.setPiecePosition!.x
      let pinZ = store.setPiecePosition!.z
      if (store.phase === 'kickoff' && store.ballPossession) {
        const holder = playerRegistry.get(store.ballPossession.playerId)
        if (holder) {
          const feet = getBallAtFeet(holder)
          pinX = feet.x
          pinZ = feet.z
        }
      }

      const pos = { x: pinX, y: restY, z: pinZ }
      body.setTranslation(pos, true)
      ballRef.current = pos
      ballRef.velocity = { x: 0, y: 0, z: 0 }
    } catch {
      ballBodyRef.current = null
    }
  })

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
      position={[0, ballRestY(BALL_RADIUS), 0]}
      userData={{ isBall: true }}
    >
      <BallCollider
        args={[BALL_RADIUS]}
        friction={BALL_FRICTION}
        restitution={BALL_RESTITUTION}
        restitutionCombineRule={CoefficientCombineRule.Min}
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

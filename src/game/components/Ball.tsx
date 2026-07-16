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
import { ballBodyRef, ballRef } from '../systems/entityRegistry'
import { updateGkHandPositions } from '../systems/goalkeeperHands'
import {
  ensureBallKinematic,
  isSetPieceLaunchActive,
  syncBallFromBody,
} from '../systems/ballPhysics'
import { ballRestY } from '../systems/fieldData'
import { isActiveSetPiecePhase } from '../systems/setPiece'

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
  const restY = ballRestY(BALL_RADIUS)

  const ballTexture = useLoader(TextureLoader, '/textures/ball.jpg')
  const ballMaterial = useMemo(() => createBallMaterial(ballTexture), [ballTexture])

  useEffect(() => {
    if (bodyRef.current) ballBodyRef.current = bodyRef.current
  }, [])

  useFrame(() => {
    if (!bodyRef.current) return

    const store = useGameStore.getState()
    if (store.phase === 'replay') return

    if (isSetPieceLaunchActive()) {
      syncBallFromBody(bodyRef.current)
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

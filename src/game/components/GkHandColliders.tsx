import { useFrame } from '@react-three/fiber'
import {
  BallCollider,
  CoefficientCombineRule,
  RigidBody,
  type RapierRigidBody,
} from '@react-three/rapier'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  GK_BODY_BONE_RADIUS,
  GK_BODY_FRICTION,
  GK_BODY_RESTITUTION,
  GK_HAND_FRICTION,
  GK_HAND_RADIUS,
  GK_HAND_RESTITUTION,
  PHYSICS_DEBUG,
} from '../constants'
import { areGkPhysicsCollidersActive } from '../systems/goalkeeper'
import { handleGkBallCollision } from '../systems/gkHandPhysics'
import { getGkBodyBones, getGkHandBones } from '../systems/goalkeeperHands'

const _pos = new THREE.Vector3()
const OFF_FIELD = { x: 0, y: -80, z: 0 }

type GkBoneEntry = {
  bone: THREE.Object3D
  radius: number
  restitution: number
  friction: number
  part: 'left' | 'right' | 'body'
  body: RapierRigidBody | null
}

type GkBoneSphereProps = {
  gkId: string
  part: 'left' | 'right' | 'body'
  radius: number
  restitution: number
  friction: number
  index: number
  entriesRef: React.MutableRefObject<GkBoneEntry[]>
}

function GkBoneSphere({
  gkId,
  part,
  radius,
  restitution,
  friction,
  index,
  entriesRef,
}: GkBoneSphereProps) {
  return (
    <RigidBody
      ref={(body) => {
        if (!body) return
        const entry = entriesRef.current[index]
        if (entry) entry.body = body
      }}
      type="kinematicPosition"
      colliders={false}
      canSleep={false}
      userData={{ isGkSaveCollider: true, gkId, part }}
    >
      <BallCollider
        args={[radius]}
        friction={friction}
        restitution={restitution}
        restitutionCombineRule={CoefficientCombineRule.Max}
        frictionCombineRule={CoefficientCombineRule.Max}
        onCollisionEnter={(e) => {
          const other = e.other.rigidBodyObject
          if (!other?.userData?.isBall) return
          handleGkBallCollision(gkId, part)
        }}
      />
      {PHYSICS_DEBUG && (
        <mesh renderOrder={1001}>
          <sphereGeometry args={[radius, 8, 8]} />
          <meshBasicMaterial
            color={part === 'body' ? '#fb923c' : '#facc15'}
            wireframe
            transparent
            opacity={0.9}
            depthTest={false}
          />
        </mesh>
      )}
    </RigidBody>
  )
}

type GkHandCollidersProps = {
  gkId: string
  modelRootRef: React.RefObject<THREE.Group | null>
}

export function GkHandColliders({ gkId, modelRootRef }: GkHandCollidersProps) {
  const [bones, setBones] = useState<{
    left: THREE.Object3D
    right: THREE.Object3D
    body: THREE.Object3D[]
  } | null>(null)
  const entriesRef = useRef<GkBoneEntry[]>([])
  const parkedRef = useRef(true)

  useEffect(() => {
    const root = modelRootRef.current
    if (!root) return
    const hands = getGkHandBones(root)
    if (hands.left && hands.right) {
      setBones({
        left: hands.left,
        right: hands.right,
        body: getGkBodyBones(root),
      })
    }
  }, [modelRootRef])

  useFrame(() => {
    if (!bones) {
      const root = modelRootRef.current
      if (!root) return
      const hands = getGkHandBones(root)
      if (hands.left && hands.right) {
        setBones({
          left: hands.left,
          right: hands.right,
          body: getGkBodyBones(root),
        })
      }
      return
    }

    if (entriesRef.current.length === 0) {
      const list: GkBoneEntry[] = [
        {
          bone: bones.left,
          radius: GK_HAND_RADIUS,
          restitution: GK_HAND_RESTITUTION,
          friction: GK_HAND_FRICTION,
          part: 'left',
          body: null,
        },
        {
          bone: bones.right,
          radius: GK_HAND_RADIUS,
          restitution: GK_HAND_RESTITUTION,
          friction: GK_HAND_FRICTION,
          part: 'right',
          body: null,
        },
        ...bones.body.map((bone) => ({
          bone,
          radius: GK_BODY_BONE_RADIUS,
          restitution: GK_BODY_RESTITUTION,
          friction: GK_BODY_FRICTION,
          part: 'body' as const,
          body: null,
        })),
      ]
      entriesRef.current = list
    }

    const active = areGkPhysicsCollidersActive(gkId)
    if (!active) {
      if (!parkedRef.current) {
        for (const entry of entriesRef.current) {
          entry.body?.setNextKinematicTranslation(OFF_FIELD)
        }
        parkedRef.current = true
      }
      return
    }

    parkedRef.current = false
    for (const entry of entriesRef.current) {
      const body = entry.body
      if (!body) continue
      entry.bone.getWorldPosition(_pos)
      body.setNextKinematicTranslation({ x: _pos.x, y: _pos.y, z: _pos.z })
    }
  })

  if (!bones) return null

  const handCount = 2

  return (
    <>
      <GkBoneSphere
        gkId={gkId}
        part="left"
        radius={GK_HAND_RADIUS}
        restitution={GK_HAND_RESTITUTION}
        friction={GK_HAND_FRICTION}
        index={0}
        entriesRef={entriesRef}
      />
      <GkBoneSphere
        gkId={gkId}
        part="right"
        radius={GK_HAND_RADIUS}
        restitution={GK_HAND_RESTITUTION}
        friction={GK_HAND_FRICTION}
        index={1}
        entriesRef={entriesRef}
      />
      {bones.body.map((bone, i) => (
        <GkBoneSphere
          key={bone.uuid}
          gkId={gkId}
          part="body"
          radius={GK_BODY_BONE_RADIUS}
          restitution={GK_BODY_RESTITUTION}
          friction={GK_BODY_FRICTION}
          index={handCount + i}
          entriesRef={entriesRef}
        />
      ))}
    </>
  )
}

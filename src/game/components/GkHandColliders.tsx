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
/** Longe do campo — NÃO usar (0,y,0): o spawn da bola é a origem */
const OFF_FIELD = { x: 200, y: -80, z: 200 }

type GkBoneEntry = {
  bone: THREE.Object3D
  part: 'left' | 'right' | 'body'
  body: RapierRigidBody | null
}

type GkBoneDef = {
  bone: THREE.Object3D
  part: 'left' | 'right' | 'body'
  radius: number
  restitution: number
  friction: number
}

type GkHandCollidersProps = {
  gkId: string
  modelRootRef: React.RefObject<THREE.Group | null>
}

function discoverGkBones(root: THREE.Object3D): GkBoneDef[] | null {
  const hands = getGkHandBones(root)
  if (!hands.left || !hands.right) return null
  return [
    {
      bone: hands.left,
      part: 'left',
      radius: GK_HAND_RADIUS,
      restitution: GK_HAND_RESTITUTION,
      friction: GK_HAND_FRICTION,
    },
    {
      bone: hands.right,
      part: 'right',
      radius: GK_HAND_RADIUS,
      restitution: GK_HAND_RESTITUTION,
      friction: GK_HAND_FRICTION,
    },
    ...getGkBodyBones(root).map((bone) => ({
      bone,
      part: 'body' as const,
      radius: GK_BODY_BONE_RADIUS,
      restitution: GK_BODY_RESTITUTION,
      friction: GK_BODY_FRICTION,
    })),
  ]
}

export function GkHandColliders({ gkId, modelRootRef }: GkHandCollidersProps) {
  const [boneDefs, setBoneDefs] = useState<GkBoneDef[]>([])
  const entriesRef = useRef<GkBoneEntry[]>([])
  // false: no 1º frame inativo força park (bodies nascem fora do osso)
  const parkedRef = useRef(false)

  useEffect(() => {
    const root = modelRootRef.current
    if (!root) return
    const defs = discoverGkBones(root)
    if (defs) setBoneDefs(defs)
  }, [modelRootRef])

  useFrame(() => {
    if (boneDefs.length === 0) {
      const root = modelRootRef.current
      if (!root) return
      const defs = discoverGkBones(root)
      if (defs) setBoneDefs(defs)
      return
    }

    const active = areGkPhysicsCollidersActive(gkId)
    const entries = entriesRef.current

    if (!active) {
      if (!parkedRef.current) {
        for (const entry of entries) {
          entry.body?.setNextKinematicTranslation(OFF_FIELD)
        }
        parkedRef.current = true
      }
      return
    }

    parkedRef.current = false
    for (const entry of entries) {
      const body = entry.body
      if (!body) continue
      entry.bone.getWorldPosition(_pos)
      body.setNextKinematicTranslation({ x: _pos.x, y: _pos.y, z: _pos.z })
    }
  })

  if (boneDefs.length === 0) return null

  return (
    <>
      {boneDefs.map(({ bone, part, radius, restitution, friction }, index) => (
        <RigidBody
          key={bone.uuid}
          ref={(body) => {
            if (!body) return
            const entries = entriesRef.current
            // Cria a entry no ref (como PlayerBoneColliders) — se esperar o
            // useFrame, o body nunca é ligado e o colisor fica em OFF_FIELD.
            if (!entries[index]) {
              entries[index] = { bone, part, body }
            } else {
              entries[index].body = body
              entries[index].bone = bone
              entries[index].part = part
            }
            try {
              body.setTranslation(OFF_FIELD, true)
            } catch {
              /* body ainda não pronto */
            }
            parkedRef.current = false
          }}
          type="kinematicPosition"
          colliders={false}
          canSleep={false}
          position={[OFF_FIELD.x, OFF_FIELD.y, OFF_FIELD.z]}
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
      ))}
    </>
  )
}

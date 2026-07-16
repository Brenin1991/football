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
  PHYSICAL_FOOT_COLLIDERS,
  PHYSICAL_FOOT_RADIUS,
  PHYSICS_DEBUG,
  PLAYER_BODY_BONE_RADIUS,
  PLAYER_BONE_FRICTION,
  PLAYER_BONE_RESTITUTION,
  PLAYER_FOOT_RADIUS,
  PLAYER_SLIDE_FOOT_RADIUS,
} from '../constants'
import { useGameStore } from '../store/gameStore'
import { playerRegistry } from '../systems/entityRegistry'
import {
  arePlayerPhysicsCollidersActiveCached,
  handlePlayerBallCollision,
} from '../systems/playerFootPhysics'
import { isCrossVolleyShooterShielded } from '../systems/crossAssist'
import {
  getPlayerBoneRefs,
  getPlayerContactBones,
  type PlayerBonePart,
} from '../systems/playerSkeleton'

const _pos = new THREE.Vector3()
const OFF_FIELD = { x: 0, y: -80, z: 0 }

type BoneEntry = {
  bone: THREE.Object3D
  part: PlayerBonePart
  body: RapierRigidBody | null
}

function boneRadius(part: PlayerBonePart): number {
  if (part === 'foot') {
    return PHYSICAL_FOOT_COLLIDERS ? PHYSICAL_FOOT_RADIUS : PLAYER_SLIDE_FOOT_RADIUS
  }
  if (part === 'leg') return PLAYER_FOOT_RADIUS
  return PLAYER_BODY_BONE_RADIUS
}

function boneDebugColor(part: PlayerBonePart): string {
  if (part === 'foot') return '#22c55e'
  if (part === 'leg') return '#4ade80'
  return '#60a5fa'
}

function arePlayerBoneCollidersActive(playerId: string): boolean {
  if (isCrossVolleyShooterShielded(playerId)) return false

  const store = useGameStore.getState()
  const passIntent = store.passIntent
  if (passIntent?.passType === 'cross') {
    const player = playerRegistry.get(playerId)
    if (player && player.team === passIntent.passingTeam) {
      return false
    }
  }
  if (store.phase === 'replay') return false
  return arePlayerPhysicsCollidersActiveCached(playerId)
}

type PlayerBoneCollidersProps = {
  playerId: string
  modelRootRef: React.RefObject<THREE.Group | null>
}

export function PlayerBoneColliders({ playerId, modelRootRef }: PlayerBoneCollidersProps) {
  const [boneDefs, setBoneDefs] = useState<ReturnType<typeof getPlayerContactBones>>([])
  const entriesRef = useRef<BoneEntry[]>([])
  const parkedRef = useRef(true)

  useEffect(() => {
    const root = modelRootRef.current
    if (!root) return
    const bones = getPlayerContactBones(root)
    if (bones.length > 0) setBoneDefs(bones)
  }, [modelRootRef])

  useFrame(() => {
    if (boneDefs.length === 0) {
      const root = modelRootRef.current
      if (!root) return
      const bones = getPlayerContactBones(root)
      if (bones.length > 0) setBoneDefs(bones)
      return
    }

    const active = arePlayerBoneCollidersActive(playerId)
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

  const liveDefs = boneDefs.length > 0 ? boneDefs : getPlayerBoneRefs(playerId)
  if (liveDefs.length === 0) return null

  return (
    <>
      {liveDefs.map(({ bone, part }, index) => {
        const radius = boneRadius(part)
        return (
          <RigidBody
            key={bone.uuid}
            ref={(body) => {
              if (!body) return
              const entries = entriesRef.current
              if (!entries[index]) {
                entries[index] = { bone, part, body }
              } else {
                entries[index].body = body
                entries[index].bone = bone
                entries[index].part = part
              }
            }}
            type="kinematicPosition"
            colliders={false}
            canSleep={false}
            userData={{ isPlayerBoneCollider: true, playerId, part }}
          >
            <BallCollider
              args={[radius]}
              friction={PLAYER_BONE_FRICTION}
              restitution={PLAYER_BONE_RESTITUTION}
              restitutionCombineRule={CoefficientCombineRule.Max}
              frictionCombineRule={CoefficientCombineRule.Max}
              onCollisionEnter={(e) => {
                const other = e.other.rigidBodyObject
                if (!other?.userData?.isBall) return
                handlePlayerBallCollision(playerId, part)
              }}
            />
            {PHYSICS_DEBUG && (
              <mesh renderOrder={1001}>
                <sphereGeometry args={[radius, 8, 8]} />
                <meshBasicMaterial
                  color={boneDebugColor(part)}
                  wireframe
                  transparent
                  opacity={0.88}
                  depthTest={false}
                />
              </mesh>
            )}
          </RigidBody>
        )
      })}
    </>
  )
}

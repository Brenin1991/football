import { useMemo } from 'react'
import * as THREE from 'three'
import { PHYSICS_DEBUG } from '../constants'
import { useGameStore } from '../store/gameStore'
import {
  PENALTY_BOX_DEPTH,
  PENALTY_BOX_HALF_WIDTH,
  getAttackSign,
  getDefensiveGoalZ,
} from '../systems/teamField'
import type { GoalZone, TeamId } from '../types'

function debugMat(color: string, opacity = 0.85) {
  return new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity,
    depthTest: false,
  })
}

function DebugCuboid({
  position,
  halfExtents,
  color,
  opacity = 0.85,
}: {
  position: [number, number, number]
  halfExtents: [number, number, number]
  color: string
  opacity?: number
}) {
  const mat = useMemo(() => debugMat(color, opacity), [color, opacity])
  return (
    <mesh position={position} renderOrder={999}>
      <boxGeometry args={[halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2]} />
      <primitive object={mat} attach="material" />
    </mesh>
  )
}

function DebugGoalZone({ zone }: { zone: GoalZone }) {
  const mat = useMemo(
    () =>
      debugMat(zone.team === 'home' ? '#4ade80' : '#f87171', 0.9),
    [zone.team],
  )
  const cx = (zone.minX + zone.maxX) / 2
  const cy = (zone.minY + zone.maxY) / 2
  const cz = (zone.minZ + zone.maxZ) / 2
  const sx = zone.maxX - zone.minX
  const sy = zone.maxY - zone.minY
  const sz = zone.maxZ - zone.minZ

  return (
    <mesh position={[cx, cy, cz]} renderOrder={998}>
      <boxGeometry args={[sx, sy, sz]} />
      <primitive object={mat} attach="material" />
    </mesh>
  )
}

function DebugPenaltyBox({ team }: { team: TeamId }) {
  const bounds = useGameStore((s) => s.fieldBounds)
  const mat = useMemo(() => debugMat('#e879f9', 0.75), [])

  if (!bounds) return null

  const goalZ = getDefensiveGoalZ(team, bounds)
  const intoField = getAttackSign(team, bounds)
  const cx = bounds.center.x
  const cy = bounds.center.y + 0.06
  const cz = goalZ + intoField * (PENALTY_BOX_DEPTH / 2)

  return (
    <mesh position={[cx, cy, cz]} renderOrder={997}>
      <boxGeometry
        args={[PENALTY_BOX_HALF_WIDTH * 2, 0.12, PENALTY_BOX_DEPTH]}
      />
      <primitive object={mat} attach="material" />
    </mesh>
  )
}

function DebugFieldBounds() {
  const bounds = useGameStore((s) => s.fieldBounds)
  const mat = useMemo(() => debugMat('#a3e635', 0.55), [])

  if (!bounds) return null

  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const sx = bounds.maxX - bounds.minX
  const sz = bounds.maxZ - bounds.minZ

  return (
    <mesh position={[cx, bounds.center.y, cz]} renderOrder={996}>
      <boxGeometry args={[sx, 0.08, sz]} />
      <primitive object={mat} attach="material" />
    </mesh>
  )
}

export function PhysicsDebug() {
  const goalZones = useGameStore((s) => s.goalZones)
  const pitchCollider = useGameStore((s) => s.pitchCollider)
  const goalFrameColliders = useGameStore((s) => s.goalFrameColliders)

  if (!PHYSICS_DEBUG) return null

  return (
    <group name="physics-debug">
      <DebugFieldBounds />
      <DebugPenaltyBox team="home" />
      <DebugPenaltyBox team="away" />
      {goalZones.map((zone) => (
        <DebugGoalZone key={zone.team} zone={zone} />
      ))}
      {pitchCollider && (
        <DebugCuboid
          position={pitchCollider.position}
          halfExtents={pitchCollider.halfExtents}
          color="#84cc16"
          opacity={0.5}
        />
      )}
      {goalFrameColliders.map((frame, i) => (
        <DebugCuboid
          key={`${frame.part}-${i}`}
          position={frame.position}
          halfExtents={frame.halfExtents}
          color={frame.part === 'post' ? '#38bdf8' : '#0ea5e9'}
          opacity={0.95}
        />
      ))}
    </group>
  )
}

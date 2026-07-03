import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { ATTACK_THIRD_DIST, crowdSfx } from '../systems/crowdSfx'
import { ballRef } from '../systems/entityRegistry'
import { getAttackingGoalZ, getAttackSign } from '../systems/teamField'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { getSimDelta } from '../systems/gameTime'

const STAND_PHASES = new Set([
  'intro',
  'playing',
  'kickoff',
  'throw-in',
  'corner',
  'goal-kick',
  'free-kick',
  'penalty',
])

function shouldPlayStand(phase: string) {
  return STAND_PHASES.has(phase)
}

export function CrowdManager() {
  const phase = useGameStore((s) => s.phase)
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const prevPossessionRef = useRef<{ team: string; playerId: string } | null>(null)
  const attackResetTimer = useRef(0)

  useEffect(() => {
    crowdSfx.setStandActive(shouldPlayStand(phase))
  }, [phase])

  useEffect(() => {
    return useGameStore.subscribe((state, prev) => {
      const prevPoss = prev.ballPossession
      const nextPoss = state.ballPossession

      if (
        nextPoss?.team === getUserTeam() &&
        prevPoss?.team === 'away' &&
        state.phase === 'playing'
      ) {
        crowdSfx.notifyHomeSteal()
      }

      if (state.phase === 'goal-celebration' && prev.phase !== 'goal-celebration') {
        crowdSfx.playGoal()
        return
      }

      if (state.phase === 'goal' && prev.phase !== 'goal') {
        return
      }
    })
  }, [])

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    if (!fieldBounds || store.phase !== 'playing') return

    const simDelta = getSimDelta(delta)

    const possession = store.ballPossession
    if (possession?.team !== getUserTeam()) {
      attackResetTimer.current += simDelta
      if (attackResetTimer.current > 2.5) {
        crowdSfx.resetAttackCheerArm()
        attackResetTimer.current = 0
      }
      prevPossessionRef.current = possession
      return
    }

    attackResetTimer.current = 0
    const goalZ = getAttackingGoalZ(getUserTeam(), fieldBounds)
    const sign = getAttackSign(getUserTeam(), fieldBounds)
    const distToGoal = (goalZ - ballRef.current.z) * sign

    if (distToGoal > 0 && distToGoal < ATTACK_THIRD_DIST) {
      crowdSfx.notifyHomeAttackPush(distToGoal)
    }

    if (distToGoal > ATTACK_THIRD_DIST + 6) {
      crowdSfx.resetAttackCheerArm()
    }

    prevPossessionRef.current = possession
  })

  return null
}

import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { ATTACK_THIRD_DIST } from '../systems/crowdSfx'
import { narrationSfx } from '../systems/narrationSfx'
import {
  isBallRecoveredFromOpponent,
  isFailedPassClaim,
} from '../systems/passNarration'
import { ballRef } from '../systems/entityRegistry'
import { getAttackingGoalZ, getAttackSign } from '../systems/teamField'
import { getSimDelta } from '../systems/gameTime'
import { useGameStore } from '../store/gameStore'

export function NarrationManager() {
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const attackResetTimer = useRef({ home: 0, away: 0 })

  useEffect(() => {
    return useGameStore.subscribe((state, prev) => {
      const prevPoss = prev.ballPossession
      const nextPoss = state.ballPossession

      if (state.phase === 'goal-celebration' && prev.phase !== 'goal-celebration') {
        narrationSfx.playGoal()
        return
      }

      if (state.phase === 'goal' && prev.phase !== 'goal') {
        return
      }

      if (state.phase !== 'playing') return

      if (isFailedPassClaim(prev.passIntent, prevPoss, nextPoss)) {
        narrationSfx.playPassError()
        return
      }

      if (isBallRecoveredFromOpponent(prev, nextPoss)) {
        narrationSfx.playGetBall()
      }
    })
  }, [])

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    if (!fieldBounds || store.phase !== 'playing') return

    const simDelta = getSimDelta(delta)

    const possession = store.ballPossession

    for (const team of ['home', 'away'] as const) {
      if (possession?.team !== team) {
        attackResetTimer.current[team] += simDelta
        if (attackResetTimer.current[team] > 2.5) {
          narrationSfx.resetAttackPushArm(team)
          attackResetTimer.current[team] = 0
        }
      } else {
        attackResetTimer.current[team] = 0
      }
    }

    if (!possession) return

    const team = possession.team
    const goalZ = getAttackingGoalZ(team, fieldBounds)
    const sign = getAttackSign(team, fieldBounds)
    const distToGoal = (goalZ - ballRef.current.z) * sign

    if (distToGoal > 0 && distToGoal < ATTACK_THIRD_DIST) {
      narrationSfx.notifyAttackPush(team, distToGoal)
    }

    if (distToGoal > ATTACK_THIRD_DIST + 6) {
      narrationSfx.resetAttackPushArm(team)
    }
  })

  return null
}

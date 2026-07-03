import { getGoalkeeperId } from '../constants'
import { ballRef, playerRegistry } from '../systems/entityRegistry'
import { getCachedTeamMarker } from '../systems/dynamicFormation'
import { getOpponent, getUserTeam, useGameStore } from '../store/gameStore'
import { HudPlayerCard } from './HudPlayerCard'
import { HudRadar } from './HudRadar'
import type { TeamId } from '../types'

const DEFAULT_HOME_OUTFIELD = 'home-9'
const DEFAULT_AWAY_OUTFIELD = 'away-10'

function resolveUserPlayerId(activeId: string): string {
  const userTeam = getUserTeam()
  if (activeId.startsWith(`${userTeam}-`) && activeId !== getGoalkeeperId(userTeam)) {
    return activeId
  }
  return userTeam === 'home' ? DEFAULT_HOME_OUTFIELD : DEFAULT_AWAY_OUTFIELD
}

function resolveOpponentPlayerId(
  team: TeamId,
  possession: { playerId: string; team: string } | null,
): string {
  const defaultId = team === 'home' ? DEFAULT_HOME_OUTFIELD : DEFAULT_AWAY_OUTFIELD

  if (possession?.team === team && possession.playerId) {
    return possession.playerId
  }

  const marker = getCachedTeamMarker(team)
  if (marker && marker !== getGoalkeeperId(team)) {
    return marker
  }

  if (possession?.team === getOpponent(team)) {
    let nearest = defaultId
    let minDist = Infinity
    const ball = ballRef.current
    for (const p of playerRegistry.values()) {
      if (p.team !== team || p.id === getGoalkeeperId(team)) continue
      const dx = p.position.x - ball.x
      const dz = p.position.z - ball.z
      const d = dx * dx + dz * dz
      if (d < minDist) {
        minDist = d
        nearest = p.id
      }
    }
    return nearest
  }

  return defaultId
}

export function HudPlayerCards() {
  const phase = useGameStore((s) => s.phase)
  const activePlayerId = useGameStore((s) => s.activePlayerId)
  const ballPossession = useGameStore((s) => s.ballPossession)

  if (
    phase === 'replay' ||
    phase === 'intro' ||
    phase === 'goal-celebration'
  ) {
    return null
  }

  const userTeam = getUserTeam()
  const homeId =
    userTeam === 'home'
      ? resolveUserPlayerId(activePlayerId)
      : resolveOpponentPlayerId('home', ballPossession)
  const awayId =
    userTeam === 'away'
      ? resolveUserPlayerId(activePlayerId)
      : resolveOpponentPlayerId('away', ballPossession)

  return (
    <div className="psx-bottom-bar">
      <HudPlayerCard playerId={homeId} team="home" controlled={userTeam === 'home'} />
      <HudRadar />
      <HudPlayerCard playerId={awayId} team="away" controlled={userTeam === 'away'} />
    </div>
  )
}

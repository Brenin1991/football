import { getGoalkeeperId } from '../constants'
import { ballRef, playerRegistry } from '../systems/entityRegistry'
import { getCachedTeamMarker } from '../systems/dynamicFormation'
import { USER_TEAM, useGameStore } from '../store/gameStore'
import { HudPlayerCard } from './HudPlayerCard'
import { HudRadar } from './HudRadar'

const DEFAULT_HOME_OUTFIELD = 'home-9'
const DEFAULT_AWAY_OUTFIELD = 'away-10'

function resolveHomePlayerId(activeId: string): string {
  if (activeId && activeId !== getGoalkeeperId(USER_TEAM)) {
    return activeId
  }
  return DEFAULT_HOME_OUTFIELD
}

function resolveAwayPlayerId(
  possession: { playerId: string; team: string } | null,
): string {
  if (possession?.team === 'away' && possession.playerId) {
    return possession.playerId
  }

  const marker = getCachedTeamMarker('away')
  if (marker && marker !== getGoalkeeperId('away')) {
    return marker
  }

  if (possession?.team === 'home') {
    let nearest = DEFAULT_AWAY_OUTFIELD
    let minDist = Infinity
    const ball = ballRef.current
    for (const p of playerRegistry.values()) {
      if (p.team !== 'away' || p.id === getGoalkeeperId('away')) continue
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

  return DEFAULT_AWAY_OUTFIELD
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

  const homeId = resolveHomePlayerId(activePlayerId)
  const awayId = resolveAwayPlayerId(ballPossession)

  return (
    <div className="psx-bottom-bar">
      <HudPlayerCard playerId={homeId} team="home" />
      <HudRadar />
      <HudPlayerCard playerId={awayId} team="away" />
    </div>
  )
}

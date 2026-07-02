import { TEAM_NAMES } from '../constants'
import { formatMatchTime, useGameStore } from '../store/gameStore'
import { formatTimeScale } from '../systems/gameTime'
import { HudPlayerCards } from './HudPlayerCards'
import { ShotPowerBar } from './ShotPowerBar'

export function HUD() {
  const half = useGameStore((s) => s.half)
  const scoreHome = useGameStore((s) => s.scoreHome)
  const scoreAway = useGameStore((s) => s.scoreAway)
  const matchTime = useGameStore((s) => s.matchTime)
  const phase = useGameStore((s) => s.phase)
  const message = useGameStore((s) => s.message)
  const timeScale = useGameStore((s) => s.timeScale)

  const isReplay = phase === 'replay'
  const hideHud = phase === 'goal-celebration' || phase === 'intro'
  const showToast =
    message &&
    phase !== 'playing' &&
    phase !== 'replay' &&
    phase !== 'goal-celebration' &&
    phase !== 'intro'

  return (
    <div className={`psx-hud${hideHud ? ' psx-hud-hidden' : ''}`}>
      <div className="psx-scoreboard">
        <span className="psx-scoreboard-team">{TEAM_NAMES.home}</span>
        <span className="psx-scoreboard-score">
          {scoreHome} : {scoreAway}
        </span>
        <span className="psx-scoreboard-team">{TEAM_NAMES.away}</span>
        <span className="psx-scoreboard-time">{formatMatchTime(matchTime)}</span>
        <span className="psx-scoreboard-half">{half === 1 ? '1T' : '2T'}</span>
      </div>

      {timeScale !== 1 && !isReplay && (
        <div className={`psx-speed${timeScale === 0 ? ' paused' : ''}`}>
          {formatTimeScale(timeScale)}
        </div>
      )}

      {!isReplay && <HudPlayerCards />}

      {showToast && <div className="psx-toast">{message}</div>}

      {!isReplay && <ShotPowerBar />}
    </div>
  )
}

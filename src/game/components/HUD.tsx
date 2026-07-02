import { TEAM_NAMES } from '../constants'
import { formatMatchTime, useGameStore } from '../store/gameStore'
import { formatTimeScale } from '../systems/gameTime'
import { HudPlayerCards } from './HudPlayerCards'
import { ShotPowerBar } from './ShotPowerBar'

const TEAM_ABBR = {
  home: 'BRA',
  away: 'VIS',
} as const

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
  const hideScoreboard = hideHud || isReplay
  const showToast =
    message &&
    phase !== 'playing' &&
    phase !== 'replay' &&
    phase !== 'goal-celebration' &&
    phase !== 'intro'

  return (
    <div className={`psx-hud pes-hud-shell${hideHud ? ' psx-hud-hidden' : ''}`}>
      {!hideScoreboard && (
        <>
          <div className="we-scoreboard pes-hud-surface" aria-label="Placar">
            <div className="we-scoreboard-side we-scoreboard-side--home">
              <span className="we-scoreboard-team" title={TEAM_NAMES.home}>
                {TEAM_ABBR.home}
              </span>
            </div>
            <div className="we-scoreboard-center pes-hud-highlight">
              <span className="we-scoreboard-digit">{scoreHome}</span>
              <span className="we-scoreboard-sep" aria-hidden>
                -
              </span>
              <span className="we-scoreboard-digit">{scoreAway}</span>
            </div>
            <div className="we-scoreboard-side we-scoreboard-side--away">
              <span className="we-scoreboard-team" title={TEAM_NAMES.away}>
                {TEAM_ABBR.away}
              </span>
            </div>
          </div>

          <div className="we-clock pes-hud-surface" aria-label="Tempo de jogo">
            <span className="we-clock-half">{half === 1 ? '1st' : '2nd'}</span>
            <span className="we-clock-time">{formatMatchTime(matchTime)}</span>
          </div>
        </>
      )}

      {timeScale !== 1 && !isReplay && (
        <div className={`psx-speed pes-hud-surface${timeScale === 0 ? ' paused' : ''}`}>
          {formatTimeScale(timeScale)}
        </div>
      )}

      {!isReplay && <HudPlayerCards />}

      {showToast && <div className="psx-toast pes-hud-surface">{message}</div>}

      {!isReplay && <ShotPowerBar />}
    </div>
  )
}

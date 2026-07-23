import { getTeamAbbr, getTeamDbId, getTeamName } from '../matchRuntime'
import { EntityImage } from '../../components/EntityImage'
import { formatMatchTime, useGameStore } from '../store/gameStore'
import { formatTimeScale } from '../systems/gameTime'
import { HudPlayerCards } from './HudPlayerCards'
import { FreeKickBallContact } from './FreeKickBallContact'

export function HUD() {
  const half = useGameStore((s) => s.half)
  const scoreHome = useGameStore((s) => s.scoreHome)
  const scoreAway = useGameStore((s) => s.scoreAway)
  const matchTime = useGameStore((s) => s.matchTime)
  const phase = useGameStore((s) => s.phase)
  const message = useGameStore((s) => s.message)
  const timeScale = useGameStore((s) => s.timeScale)
  const controlMode = useGameStore((s) => s.controlMode)
  const proAssistMode = useGameStore((s) => s.proAssistMode)
  const pauseMenuOpen = useGameStore((s) => s.pauseMenuOpen)

  const homeAbbr = getTeamAbbr('home')
  const awayAbbr = getTeamAbbr('away')

  const isReplay = phase === 'replay'
  const hideHud = phase === 'goal-celebration' || phase === 'intro' || pauseMenuOpen
  const hideScoreboard = hideHud || isReplay
  const showToast =
    message &&
    phase !== 'playing' &&
    phase !== 'replay' &&
    phase !== 'goal-celebration' &&
    phase !== 'intro'
  const showProAssist = controlMode === 'pro' && !hideHud && !isReplay

  return (
    <div
      className={`fifa-hud psx-hud${hideHud ? ' fifa-hud--hidden psx-hud-hidden' : ''}${
        controlMode === 'pro' ? ' psx-hud--pro' : ''
      }`}
    >
      {!hideScoreboard && (
        <>
          <div className="we-scoreboard" aria-label="Placar">
            <div className="we-scoreboard-side we-scoreboard-side--home">
              <EntityImage
                entityType="team"
                entityId={getTeamDbId('home')}
                alt={getTeamName('home')}
                className="we-scoreboard-crest"
                fallback={null}
              />
              <span className="we-scoreboard-team" title={getTeamName('home')}>
                {homeAbbr}
              </span>
            </div>
            <div className="we-scoreboard-center">
              <span className="we-scoreboard-digit">{scoreHome}</span>
              <span className="we-scoreboard-sep" aria-hidden>
                -
              </span>
              <span className="we-scoreboard-digit">{scoreAway}</span>
            </div>
            <div className="we-scoreboard-side we-scoreboard-side--away">
              <EntityImage
                entityType="team"
                entityId={getTeamDbId('away')}
                alt={getTeamName('away')}
                className="we-scoreboard-crest"
                fallback={null}
              />
              <span className="we-scoreboard-team" title={getTeamName('away')}>
                {awayAbbr}
              </span>
            </div>
          </div>

          <div className="we-clock" aria-label="Tempo de jogo">
            <span className="we-clock-half">{half === 1 ? '1st' : '2nd'}</span>
            <span className="we-clock-time">{formatMatchTime(matchTime)}</span>
          </div>
        </>
      )}

      {showProAssist && (
        <div
          className={`psx-pro-assist${proAssistMode === 'free' ? ' psx-pro-assist--free' : ''}`}
          aria-label="Modo de assistência"
        >
          <span className="psx-pro-assist__mode">
            {proAssistMode === 'assisted' ? 'Assistido' : 'Livre'}
          </span>
          <span className="psx-pro-assist__hint">Select</span>
        </div>
      )}

      {timeScale !== 1 && !isReplay && (
        <div className={`psx-speed${timeScale === 0 ? ' paused' : ''}`}>
          {formatTimeScale(timeScale)}
        </div>
      )}

      {!isReplay && <HudPlayerCards />}
      {!isReplay && <FreeKickBallContact />}

      {showToast && <div className="psx-toast hud-anim">{message}</div>}
    </div>
  )
}

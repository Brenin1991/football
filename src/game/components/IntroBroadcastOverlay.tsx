import { useEffect, useState } from 'react'
import { TEAM_NAMES } from '../constants'
import {
  FORMATION_LABEL,
  getTeamBroadcastName,
  getTeamLineup,
  MATCH_OFFICIALS,
  MATCH_TYPE_LABEL,
  STADIUM_NAME,
} from '../data/matchBroadcast'
import {
  getIntroBroadcastPanel,
  getIntroPanelFade,
  isIntroBroadcastVisible,
  type IntroBroadcastPanel,
} from '../systems/introBroadcast'
import { entranceSystem } from '../systems/teamEntrance'
import { useGameStore } from '../store/gameStore'

function LineupPanel({
  team,
  elapsed,
}: {
  team: 'home' | 'away'
  elapsed: number
}) {
  const panel: IntroBroadcastPanel = team === 'home' ? 'home-lineup' : 'away-lineup'
  const opacity = getIntroPanelFade(elapsed, panel)
  const lineup = getTeamLineup(team)

  return (
    <div
      className={`psx-intro-panel psx-intro-panel--lineup psx-intro-panel--${team}`}
      style={{ opacity }}
    >
      <div className="psx-intro-panel-kicker">Escalação</div>
      <div className="psx-intro-panel-title">
        {getTeamBroadcastName(team)}
        <span className="psx-intro-formation">{FORMATION_LABEL}</span>
      </div>
      <ul className="psx-intro-lineup">
        {lineup.map((player) => (
          <li key={player.number}>
            <span className="psx-intro-lineup-num">{player.number}</span>
            <span className="psx-intro-lineup-pos">{player.position}</span>
            <span className="psx-intro-lineup-name">{player.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function IntroBroadcastOverlay() {
  const phase = useGameStore((s) => s.phase)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (phase !== 'intro') return
    let raf = 0
    const tick = () => {
      setElapsed(entranceSystem.getElapsed())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  if (phase !== 'intro' || !isIntroBroadcastVisible(elapsed)) return null

  const panel = getIntroBroadcastPanel(elapsed)
  const matchOpacity = getIntroPanelFade(elapsed, 'match')
  const officialsOpacity = getIntroPanelFade(elapsed, 'officials')

  return (
    <div className="psx-intro-broadcast" aria-hidden>
      <div className="psx-intro-scanlines" />

      <div className="psx-intro-live-tag">
        <span className="psx-intro-live-dot" />
        AO VIVO
      </div>

      <div className="psx-intro-network">SPORTV</div>

      {panel === 'match' && (
        <div className="psx-intro-panel psx-intro-panel--match" style={{ opacity: matchOpacity }}>
          <div className="psx-intro-stadium">{STADIUM_NAME}</div>
          <div className="psx-intro-match-type">{MATCH_TYPE_LABEL}</div>
          <div className="psx-intro-fixture">
            <span>{TEAM_NAMES.home.toUpperCase()}</span>
            <span className="psx-intro-vs">x</span>
            <span>{TEAM_NAMES.away.toUpperCase()}</span>
          </div>
        </div>
      )}

      {panel === 'home-lineup' && <LineupPanel team="home" elapsed={elapsed} />}
      {panel === 'away-lineup' && <LineupPanel team="away" elapsed={elapsed} />}

      {panel === 'officials' && (
        <div className="psx-intro-panel psx-intro-panel--officials" style={{ opacity: officialsOpacity }}>
          <div className="psx-intro-panel-kicker">Arbitragem</div>
          <ul className="psx-intro-officials">
            <li>
              <span>Árbitro</span>
              <span>{MATCH_OFFICIALS.referee}</span>
            </li>
            <li>
              <span>Assistente 1</span>
              <span>{MATCH_OFFICIALS.assistant1}</span>
            </li>
            <li>
              <span>Assistente 2</span>
              <span>{MATCH_OFFICIALS.assistant2}</span>
            </li>
            <li>
              <span>4º Árbitro</span>
              <span>{MATCH_OFFICIALS.fourth}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

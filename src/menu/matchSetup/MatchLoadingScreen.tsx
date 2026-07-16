import { useEffect, useState } from 'react'
import { getTeamWithRoster } from '../../db/queries'
import { getDatabase } from '../../db/database'
import { useAppStore } from '../../store/appStore'
import { useGameStore } from '../../game/store/gameStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { MenuShell } from '../components/MenuShell'
import { useMatchSetupData } from './useMatchSetupData'

const LOAD_MS = 2600

export function MatchLoadingScreen() {
  const startGame = useAppStore((s) => s.startGame)
  const draft = useMatchSetupStore((s) => s.draft)
  const setSession = useMatchSetupStore((s) => s.setSession)
  const clearSetup = useMatchSetupStore((s) => s.clearSetup)
  const setUserTeam = useGameStore((s) => s.setUserTeam)
  const setDifficulty = useGameStore((s) => s.setDifficulty)
  const { teams } = useMatchSetupData()

  const [progress, setProgress] = useState(0)

  const homeTeam = teams.find((team) => team.id === draft?.homeTeamId) ?? null
  const awayTeam = teams.find((team) => team.id === draft?.awayTeamId) ?? null

  useEffect(() => {
    const started = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const elapsed = now - started
      setProgress(Math.min(100, Math.round((elapsed / LOAD_MS) * 100)))
      if (elapsed < LOAD_MS) {
        frame = requestAnimationFrame(tick)
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!draft?.homeTeamId || !draft.awayTeamId) return

    const timer = window.setTimeout(() => {
      const db = getDatabase()
      const home = getTeamWithRoster(db, draft.homeTeamId!, draft.homeKit)
      const away = getTeamWithRoster(db, draft.awayTeamId!, draft.awayKit)
      if (!home || !away) return

      setUserTeam(draft.playerSide)
      setDifficulty(draft.difficulty)
      setSession({
        home,
        away,
        stadium: 'Arena Municipal',
        matchType: 'AMISTOSO',
        playerSide: draft.playerSide,
        difficulty: draft.difficulty,
      })
      clearSetup()
      startGame()
    }, LOAD_MS)

    return () => window.clearTimeout(timer)
  }, [clearSetup, draft, setDifficulty, setSession, setUserTeam, startGame])

  return (
    <MenuShell variant="wide" title="Carregando" subtitle="Preparando a partida" padEnabled={false}>
      <div className="prekick prekick--loading">
        <div className="prekick-loading__matchup">
          <span className="prekick-loading__team">{homeTeam?.shortName ?? homeTeam?.name ?? '—'}</span>
          <span className="prekick-loading__vs">VS</span>
          <span className="prekick-loading__team">{awayTeam?.shortName ?? awayTeam?.name ?? '—'}</span>
        </div>

        <div className="prekick-loading__bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span className="prekick-loading__fill" style={{ width: `${progress}%` }} />
        </div>

        <p className="prekick-loading__status">
          {progress < 35 ? 'Montando elencos...' : progress < 70 ? 'Preparando estádio...' : 'Entrando em campo...'}
        </p>
      </div>
    </MenuShell>
  )
}

import { useEffect, useState } from 'react'
import { getTeamWithRoster, setEditionPlayerHasCustomGlb } from '../../db/queries'
import { getDatabase } from '../../db/database'
import { useAppStore } from '../../store/appStore'
import { useGameStore } from '../../game/store/gameStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import {
  clearCustomPlayerGlbUrls,
  getCustomPlayerGlbUrl,
  hydrateCustomPlayerGlbs,
} from '../../game/systems/customPlayerGlb'
import { hydratePlayerAttributesFromSession } from '../../game/systems/playerAttributes'
import { resetAllStamina } from '../../game/systems/playerStamina'
import { hydrateTeamTacticsFromSession } from '../../game/systems/teamTactics'
import { MenuShell } from '../components/MenuShell'
import { useMatchSetupData } from './useMatchSetupData'

const LOAD_MS = 2800

export function MatchLoadingScreen() {
  const startGame = useAppStore((s) => s.startGame)
  const draft = useMatchSetupStore((s) => s.draft)
  const setSession = useMatchSetupStore((s) => s.setSession)
  const clearSetup = useMatchSetupStore((s) => s.clearSetup)
  const setUserTeam = useGameStore((s) => s.setUserTeam)
  const setDifficulty = useGameStore((s) => s.setDifficulty)
  const setControlMode = useGameStore((s) => s.setControlMode)
  const { teams } = useMatchSetupData()

  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Montando elencos...')

  const homeTeamId = draft?.homeTeamId ?? null
  const awayTeamId = draft?.awayTeamId ?? null
  const homeKit = draft?.homeKit ?? 1
  const awayKit = draft?.awayKit ?? 1
  const playerSide = draft?.playerSide
  const difficulty = draft?.difficulty
  const controlMode = draft?.controlMode ?? 'team'
  const proSlotIndex = draft?.proSlotIndex ?? 9

  const homeTeam = teams.find((team) => team.id === homeTeamId) ?? null
  const awayTeam = teams.find((team) => team.id === awayTeamId) ?? null

  useEffect(() => {
    if (!homeTeamId || !awayTeamId || !playerSide || !difficulty) return

    let cancelled = false
    const started = performance.now()
    let frame = 0

    const tick = () => {
      if (cancelled) return
      const elapsed = performance.now() - started
      setProgress(Math.min(95, Math.round((elapsed / LOAD_MS) * 100)))
      if (elapsed < LOAD_MS) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    void (async () => {
      try {
        const db = getDatabase()
        const home = getTeamWithRoster(db, homeTeamId, homeKit)
        const away = getTeamWithRoster(db, awayTeamId, awayKit)
        if (!home || !away || cancelled) return

        setStatus('Carregando modelos...')
        const rosterIds = [...home.roster, ...away.roster].map((p) => p.playerId)
        clearCustomPlayerGlbUrls()
        const loaded = await hydrateCustomPlayerGlbs(rosterIds)
        if (cancelled) return

        for (const id of rosterIds) {
          if (getCustomPlayerGlbUrl(id)) {
            setEditionPlayerHasCustomGlb(db, id, true)
          }
        }
        if (loaded > 0) {
          setStatus(`${loaded} modelo(s) personalizado(s)...`)
        }

        const remain = Math.max(0, LOAD_MS - (performance.now() - started))
        await new Promise((r) => setTimeout(r, remain))
        if (cancelled) return

        setProgress(100)
        setStatus('Entrando em campo...')
        setUserTeam(playerSide)
        setDifficulty(difficulty)
        setControlMode(controlMode, proSlotIndex)
        setSession({
          home,
          away,
          stadium: 'Arena Municipal',
          matchType: 'AMISTOSO',
          playerSide,
          difficulty,
          controlMode,
          proSlotIndex,
        })
        hydratePlayerAttributesFromSession()
        hydrateTeamTacticsFromSession()
        resetAllStamina()
        clearSetup()
        startGame()
      } catch (err) {
        console.error('[MatchLoading] falha ao preparar partida', err)
        setStatus('Erro ao carregar. Tente de novo.')
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [
    awayKit,
    awayTeamId,
    clearSetup,
    controlMode,
    difficulty,
    homeKit,
    homeTeamId,
    playerSide,
    proSlotIndex,
    setControlMode,
    setDifficulty,
    setSession,
    setUserTeam,
    startGame,
  ])

  return (
    <MenuShell
      variant="wide"
      title="Carregando"
      subtitle="Preparando a partida"
      padEnabled={false}
      showDefaultHints={false}
      footer={<span />}
    >
      <div className="fifa-loading">
        <div className="fifa-loading__matchup">
          <span>{homeTeam?.shortName ?? homeTeam?.name ?? '—'}</span>
          <span className="fifa-loading__vs">VS</span>
          <span>{awayTeam?.shortName ?? awayTeam?.name ?? '—'}</span>
        </div>

        <div
          className="fifa-loading__bar"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="fifa-loading__fill" style={{ width: `${progress}%` }} />
        </div>

        <p className="fifa-loading__status">{status}</p>
      </div>
    </MenuShell>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Team } from '../../db/types'
import { useAppStore } from '../../store/appStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { EntityImage } from '../../components/EntityImage'
import { withMenuSelect } from '../menuActions'
import {
  cycleKickoffLeague,
  cycleKickoffTeam,
  LeagueTeamPicker,
  type KickoffField,
} from '../components/LeagueTeamPicker'
import { MenuPadHints } from '../components/MenuPadHints'
import { MenuShell } from '../components/MenuShell'
import { useMenuPad } from '../hooks/useMenuPad'
import { buildLeagueBuckets, pickDefaultSelection } from '../matchSetupBuckets'
import { useMatchSetupData } from './useMatchSetupData'

type FocusZone =
  | 'home-league'
  | 'home-team'
  | 'away-league'
  | 'away-team'
  | 'continue'

const FOCUS_ORDER: FocusZone[] = [
  'home-league',
  'home-team',
  'away-league',
  'away-team',
  'continue',
]

export function MatchTeamScreen() {
  const dbVersion = useAppStore((s) => s.dbVersion)
  const setView = useAppStore((s) => s.setView)
  const draft = useMatchSetupStore((s) => s.draft)
  const patchDraft = useMatchSetupStore((s) => s.patchDraft)
  const setSetupStep = useMatchSetupStore((s) => s.setSetupStep)
  const backSetupStep = useMatchSetupStore((s) => s.backSetupStep)

  const { editionName, leagues, teams } = useMatchSetupData()
  const buckets = useMemo(() => buildLeagueBuckets(leagues, teams), [leagues, teams])

  const homeLeagueId = draft?.homeLeagueId ?? ''
  const homeTeamId = draft?.homeTeamId ?? ''
  const awayLeagueId = draft?.awayLeagueId ?? ''
  const awayTeamId = draft?.awayTeamId ?? ''
  const playerSide = draft?.playerSide ?? 'home'

  const [focus, setFocus] = useState<FocusZone>(
    playerSide === 'away' ? 'away-league' : 'home-league',
  )

  useEffect(() => {
    if (buckets.length === 0) return

    const homeDefault = pickDefaultSelection(buckets)
    const awayDefault = pickDefaultSelection(buckets, homeDefault?.teamId)

    if (!homeLeagueId && homeDefault) {
      patchDraft({ homeLeagueId: homeDefault.leagueId, homeTeamId: homeDefault.teamId })
    }
    if (!awayLeagueId && awayDefault) {
      patchDraft({ awayLeagueId: awayDefault.leagueId, awayTeamId: awayDefault.teamId })
    }
  }, [buckets, homeLeagueId, awayLeagueId, patchDraft])

  const homeTeam = teams.find((team) => team.id === homeTeamId) ?? null
  const awayTeam = teams.find((team) => team.id === awayTeamId) ?? null
  const canContinue = Boolean(homeTeamId && awayTeamId && homeTeamId !== awayTeamId)

  const confirm = useCallback(() => {
    if (!canContinue) return
    setSetupStep('kit')
  }, [canContinue, setSetupStep])

  const goBack = useCallback(() => {
    if (backSetupStep() === 'menu') setView('menu')
  }, [backSetupStep, setView])

  const moveFocus = useCallback((delta: -1 | 1) => {
    setFocus((current) => {
      const index = FOCUS_ORDER.indexOf(current)
      return FOCUS_ORDER[(index + delta + FOCUS_ORDER.length) % FOCUS_ORDER.length]
    })
  }, [])

  const adjustFocused = useCallback(
    (direction: -1 | 1) => {
      if (focus === 'home-league') {
        const next = cycleKickoffLeague(buckets, homeLeagueId, homeTeamId, direction, awayTeamId)
        if (!next) return
        patchDraft({ homeLeagueId: next.leagueId, homeTeamId: next.teamId })
        return
      }
      if (focus === 'home-team') {
        const next = cycleKickoffTeam(buckets, homeLeagueId, homeTeamId, direction, awayTeamId)
        if (!next) return
        patchDraft({ homeTeamId: next })
        return
      }
      if (focus === 'away-league') {
        const next = cycleKickoffLeague(buckets, awayLeagueId, awayTeamId, direction, homeTeamId)
        if (!next) return
        patchDraft({ awayLeagueId: next.leagueId, awayTeamId: next.teamId })
        return
      }
      if (focus === 'away-team') {
        const next = cycleKickoffTeam(buckets, awayLeagueId, awayTeamId, direction, homeTeamId)
        if (!next) return
        patchDraft({ awayTeamId: next })
      }
    },
    [awayLeagueId, awayTeamId, buckets, focus, homeLeagueId, homeTeamId, patchDraft],
  )

  useMenuPad({
    onUp: teams.length >= 2 ? () => moveFocus(-1) : undefined,
    onDown: teams.length >= 2 ? () => moveFocus(1) : undefined,
    onLeft: teams.length >= 2 ? () => adjustFocused(-1) : undefined,
    onRight: teams.length >= 2 ? () => adjustFocused(1) : undefined,
    onConfirm: teams.length >= 2 && focus === 'continue' ? confirm : undefined,
    onBack: goBack,
  })

  const homeField: KickoffField | null =
    focus === 'home-league' ? 'league' : focus === 'home-team' ? 'team' : null
  const awayField: KickoffField | null =
    focus === 'away-league' ? 'league' : focus === 'away-team' ? 'team' : null

  return (
    <MenuShell
      variant="wide"
      title="Escolha de times"
      subtitle={editionName}
      padEnabled={false}
      onBack={goBack}
      footer={
        teams.length >= 2 ? (
          <>
            <MenuPadHints confirm="Uniformes" back="Lado" />
            <button
              type="button"
              className={`menu-btn menu-btn--primary menu-btn--cta${focus === 'continue' ? ' menu-btn--focused' : ''}`}
              disabled={!canContinue}
              onClick={withMenuSelect(confirm)}
            >
              Escolher uniformes
            </button>
          </>
        ) : (
          <MenuPadHints back="Lado" />
        )
      }
    >
      {teams.length < 2 ? (
        <div className="menu-empty">
          <p>Cadastre pelo menos dois times na edição ativa.</p>
          <button type="button" className="menu-btn menu-btn--primary" onClick={() => setView('editor')}>
            Ir para o editor
          </button>
        </div>
      ) : (
        <div className="kickoff-screen kickoff-screen--compact">
          <div className="kickoff-compare kickoff-compare--compact menu-anim menu-anim--compare">
            <TeamCrest team={homeTeam} refreshKey={dbVersion} crestKey={homeTeam?.id ?? 'home-empty'} />
            <span className="kickoff-compare__vs">VS</span>
            <TeamCrest team={awayTeam} refreshKey={dbVersion} crestKey={awayTeam?.id ?? 'away-empty'} />
          </div>

          <div className="kickoff-pickers">
            <div className="menu-anim menu-anim--side" style={{ animationDelay: '80ms' }}>
              <LeagueTeamPicker
                side="home"
                label="Mandante"
                leagues={leagues}
                teams={teams}
                leagueId={homeLeagueId}
                teamId={homeTeamId}
                focusedField={homeField}
              />
            </div>

            <div className="menu-anim menu-anim--side" style={{ animationDelay: '140ms' }}>
              <LeagueTeamPicker
                side="away"
                label="Visitante"
                leagues={leagues}
                teams={teams}
                leagueId={awayLeagueId}
                teamId={awayTeamId}
                focusedField={awayField}
              />
            </div>
          </div>
        </div>
      )}
    </MenuShell>
  )
}

function TeamCrest({
  team,
  refreshKey,
  crestKey,
}: {
  team: Team | null
  refreshKey: number
  crestKey: string
}) {
  if (!team) {
    return (
      <div
        key={crestKey}
        className="kickoff-compare__crest kickoff-compare__crest--empty kickoff-compare__crest--pop"
      />
    )
  }

  return (
    <EntityImage
      key={crestKey}
      entityType="team"
      entityId={team.id}
      alt={team.name}
      refreshKey={refreshKey}
      className="kickoff-compare__crest kickoff-compare__crest--pop"
      fallback={
        <div className="entity-image-fallback entity-image-fallback--crest kickoff-compare__crest kickoff-compare__crest--pop" />
      }
    />
  )
}

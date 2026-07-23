import { useCallback, useEffect, useMemo, useState } from 'react'
import type { League, Team, TeamKit } from '../../db/types'
import { listTeamKits } from '../../db/queries'
import { getDatabase } from '../../db/database'
import { useAppStore } from '../../store/appStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { EntityImage } from '../../components/EntityImage'
import { withMenuSelect } from '../menuActions'
import {
  cycleKickoffLeague,
  cycleKickoffTeam,
} from '../components/LeagueTeamPicker'
import { MenuPadHints } from '../components/MenuPadHints'
import { MenuShell } from '../components/MenuShell'
import { useMenuPad } from '../hooks/useMenuPad'
import { buildLeagueBuckets, pickDefaultSelection } from '../matchSetupBuckets'
import { useMatchSetupData } from './useMatchSetupData'
import { deriveTeamRatings } from './teamRatings'

type Side = 'home' | 'away'
type Field = 'league' | 'team' | 'kit'

type FocusZone = `${Side}-${Field}` | 'continue'

const FOCUS_ORDER: FocusZone[] = [
  'home-league',
  'home-team',
  'home-kit',
  'away-league',
  'away-team',
  'away-kit',
  'continue',
]

function kitColors(kits: TeamKit[], kitNumber: 1 | 2, team: Team | null) {
  const kit = kits.find((entry) => entry.kitNumber === kitNumber)
  return {
    shirt: kit?.shirtColor ?? team?.primaryColor ?? '#1a4fa0',
    shorts: kit?.shortsColor ?? team?.secondaryColor ?? '#ffffff',
    socks: kit?.socksColor ?? team?.primaryColor ?? '#1a4fa0',
  }
}

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
  const homeKit = draft?.homeKit ?? 1
  const awayKit = draft?.awayKit ?? 2
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

  const kits = useMemo(() => {
    void dbVersion
    const db = getDatabase()
    return {
      home: homeTeamId ? listTeamKits(db, homeTeamId) : [],
      away: awayTeamId ? listTeamKits(db, awayTeamId) : [],
    }
  }, [awayTeamId, dbVersion, homeTeamId])
  const homeColors = kitColors(kits.home, homeKit, homeTeam)
  const awayColors = kitColors(kits.away, awayKit, awayTeam)

  const confirm = useCallback(() => {
    if (!canContinue) return
    setSetupStep('prematch')
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
      if (focus === 'home-kit') {
        patchDraft({ homeKit: homeKit === 1 ? 2 : 1 })
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
        return
      }
      if (focus === 'away-kit') {
        patchDraft({ awayKit: awayKit === 1 ? 2 : 1 })
      }
    },
    [
      awayKit,
      awayLeagueId,
      awayTeamId,
      buckets,
      focus,
      homeKit,
      homeLeagueId,
      homeTeamId,
      patchDraft,
    ],
  )

  useMenuPad({
    onUp: teams.length >= 2 ? () => moveFocus(-1) : undefined,
    onDown: teams.length >= 2 ? () => moveFocus(1) : undefined,
    onLeft: teams.length >= 2 ? () => adjustFocused(-1) : undefined,
    onRight: teams.length >= 2 ? () => adjustFocused(1) : undefined,
    onConfirm: teams.length >= 2 && canContinue ? confirm : undefined,
    onBack: goBack,
  })

  return (
    <MenuShell
      variant="wide"
      title="Kick Off"
      subtitle={editionName}
      backgroundColors={{
        home: homeColors.shirt,
        homeSecondary: homeColors.shorts,
        away: awayColors.shirt,
        awaySecondary: awayColors.shorts,
      }}
      padEnabled={false}
      onBack={goBack}
      footer={
        teams.length >= 2 ? (
          <>
            <MenuPadHints confirm="Avançar" back="Lado" />
            <button
              type="button"
              className={`fifa-cta${focus === 'continue' ? ' fifa-cta--focused' : ''}`}
              disabled={!canContinue}
              onClick={withMenuSelect(confirm)}
            >
              Pre-Match
            </button>
          </>
        ) : (
          <MenuPadHints back="Lado" />
        )
      }
    >
      {teams.length < 2 ? (
        <div className="fifa-empty">
          <p>Cadastre pelo menos dois times na edição ativa.</p>
          <button type="button" className="fifa-cta" onClick={() => setView('editor')}>
            Ir para o editor
          </button>
        </div>
      ) : (
        <div className="fifa-ko">
          <KickOffCard
            side="home"
            label="Home"
            leagues={leagues}
            team={homeTeam}
            leagueId={homeLeagueId}
            colors={homeColors}
            refreshKey={dbVersion}
            focus={focus}
            youControl={playerSide === 'home'}
          />
          <KickOffCard
            side="away"
            label="Away"
            leagues={leagues}
            team={awayTeam}
            leagueId={awayLeagueId}
            colors={awayColors}
            refreshKey={dbVersion}
            focus={focus}
            youControl={playerSide === 'away'}
          />
        </div>
      )}
    </MenuShell>
  )
}

function KickOffCard({
  side,
  label,
  leagues,
  team,
  leagueId,
  colors,
  refreshKey,
  focus,
  youControl,
}: {
  side: Side
  label: string
  leagues: League[]
  team: Team | null
  leagueId: string
  colors: { shirt: string; shorts: string; socks: string }
  refreshKey: number
  focus: FocusZone
  youControl: boolean
}) {
  const ratings = deriveTeamRatings(team)
  const league = leagues.find((entry) => entry.id === leagueId) ?? null
  const leagueName = league?.name ?? '—'
  const fieldFocus = (field: Field) =>
    focus === `${side}-${field}` ? ' fifa-ko-row--active' : ''

  return (
    <section className={`fifa-ko-card fifa-ko-card--${side}${youControl ? ' fifa-ko-card--you' : ''}`}>
      <div className="fifa-ko-card__top">
        <span className="fifa-ko-card__side">{label}</span>
        <div className="fifa-ko-card__top-right">
          {youControl ? <span className="fifa-ko-card__badge">P1</span> : null}
          {league ? (
            <EntityImage
              key={league.id}
              entityType="league"
              entityId={league.id}
              alt={league.name}
              refreshKey={refreshKey}
              className="fifa-ko-card__league"
              fallback={<div className="fifa-ko-card__league fifa-ko-card__league--empty" />}
            />
          ) : (
            <div className="fifa-ko-card__league fifa-ko-card__league--empty" />
          )}
        </div>
      </div>

      <div className="fifa-ko-card__visual" style={{ ['--ko-shirt' as string]: colors.shirt }}>
        {team ? (
          <EntityImage
            key={team.id}
            entityType="team"
            entityId={team.id}
            alt={team.name}
            refreshKey={refreshKey}
            className="fifa-ko-card__crest"
            fallback={<div className="fifa-ko-card__crest fifa-ko-card__crest--empty" />}
          />
        ) : (
          <div className="fifa-ko-card__crest fifa-ko-card__crest--empty" />
        )}
        <p className="fifa-ko-card__team-name">{team?.shortName ?? team?.name ?? '—'}</p>
        <div className="fifa-ko-stars" aria-label={`${ratings.stars} estrelas`}>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={i < ratings.stars ? 'fifa-ko-stars__on' : ''}>
              ★
            </span>
          ))}
        </div>
      </div>

      <div className="fifa-ko-stats">
        <div className="fifa-ko-chem">
          <span>Chem</span>
          <div className="fifa-ko-chem__bar">
            <span style={{ width: `${ratings.chem}%` }} />
          </div>
          <strong>{ratings.chem || '—'}</strong>
        </div>
        <div className="fifa-ko-attrs">
          <AttrBar label="ATT" value={ratings.att} />
          <AttrBar label="MID" value={ratings.mid} />
          <AttrBar label="DEF" value={ratings.def} />
        </div>
        <div className="fifa-ko-bump">
          <kbd>L1</kbd>
          <span>Team</span>
          <kbd>R1</kbd>
        </div>
      </div>

      <div className="fifa-ko-rows">
        <div className={`fifa-ko-row${fieldFocus('league')}`}>
          <span className="fifa-ko-row__label">League</span>
          <span className="fifa-ko-row__value">{leagueName}</span>
          <span className="fifa-ko-row__arrows">‹ ›</span>
        </div>
        <div className={`fifa-ko-row${fieldFocus('team')}`}>
          <span className="fifa-ko-row__label">Team</span>
          <span className="fifa-ko-row__value">{team?.name ?? '—'}</span>
          <span className="fifa-ko-row__arrows">‹ ›</span>
        </div>
      </div>
    </section>
  )
}

function AttrBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="fifa-ko-attr">
      <span>{label}</span>
      <div className="fifa-ko-attr__bar">
        <span style={{ width: `${value}%` }} />
      </div>
      <strong>{value || '—'}</strong>
    </div>
  )
}

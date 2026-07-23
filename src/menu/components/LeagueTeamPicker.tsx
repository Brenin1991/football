import { useMemo } from 'react'
import type { League, Team } from '../../db/types'
import {
  buildLeagueBuckets,
  resolveTeamInLeague,
  type LeagueBucket,
} from '../matchSetupBuckets'

export type KickoffField = 'league' | 'team'

type LeagueTeamPickerProps = {
  side: 'home' | 'away'
  label: string
  leagues: League[]
  teams: Team[]
  leagueId: string
  teamId: string
  focusedField: KickoffField | null
}

export function LeagueTeamPicker({
  side,
  label,
  leagues,
  teams,
  leagueId,
  teamId,
  focusedField,
}: LeagueTeamPickerProps) {
  const buckets = useMemo(() => buildLeagueBuckets(leagues, teams), [leagues, teams])
  const activeBucket = buckets.find((bucket) => bucket.id === leagueId) ?? buckets[0]
  const selectedTeam = teams.find((team) => team.id === teamId) ?? null

  return (
    <section className={`fifa-picker fifa-picker--${side}`}>
      <div className="fifa-picker__tag">{label}</div>

      <PickerRow
        title="Liga"
        value={activeBucket?.name ?? '—'}
        active={focusedField === 'league'}
      />

      <PickerRow
        title="Time"
        value={selectedTeam?.name ?? '—'}
        active={focusedField === 'team'}
      />
    </section>
  )
}

export function cycleKickoffLeague(
  buckets: LeagueBucket[],
  leagueId: string,
  teamId: string,
  direction: -1 | 1,
  blockedTeamId?: string | null,
): { leagueId: string; teamId: string } | null {
  if (buckets.length === 0) return null
  const index = buckets.findIndex((bucket) => bucket.id === leagueId)
  const base = index >= 0 ? index : 0
  const next = buckets[(base + direction + buckets.length) % buckets.length]
  if (!next) return null
  return {
    leagueId: next.id,
    teamId: resolveTeamInLeague(buckets, next.id, teamId, blockedTeamId),
  }
}

export function cycleKickoffTeam(
  buckets: LeagueBucket[],
  leagueId: string,
  teamId: string,
  direction: -1 | 1,
  blockedTeamId?: string | null,
): string | null {
  const bucket = buckets.find((entry) => entry.id === leagueId)
  if (!bucket) return null
  const selectable = bucket.teams.filter((team) => team.id !== blockedTeamId)
  if (selectable.length === 0) return null
  const index = selectable.findIndex((team) => team.id === teamId)
  const base = index >= 0 ? index : 0
  return selectable[(base + direction + selectable.length) % selectable.length].id
}

function PickerRow({
  title,
  value,
  active,
}: {
  title: string
  value: string
  active: boolean
}) {
  return (
    <div className={`fifa-row${active ? ' fifa-row--active' : ''}`}>
      <span className="fifa-row__label">{title}</span>
      <span key={value} className="fifa-row__value">
        {value}
      </span>
      <span className="fifa-row__arrows" aria-hidden>
        ‹ ›
      </span>
    </div>
  )
}

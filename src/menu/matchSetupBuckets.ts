import type { League, Team } from '../db/types'

export const UNASSIGNED_LEAGUE_ID = '__unassigned__'

export type LeagueBucket = {
  id: string
  name: string
  teams: Team[]
}

export function buildLeagueBuckets(leagues: League[], teams: Team[]): LeagueBucket[] {
  const buckets: LeagueBucket[] = leagues
    .map((league) => ({
      id: league.id,
      name: league.name,
      teams: teams.filter((team) => team.leagueId === league.id),
    }))
    .filter((bucket) => bucket.teams.length > 0)

  const unassigned = teams.filter((team) => !team.leagueId)
  if (unassigned.length > 0) {
    buckets.push({
      id: UNASSIGNED_LEAGUE_ID,
      name: 'Sem liga',
      teams: unassigned,
    })
  }

  return buckets
}

export function pickDefaultSelection(
  buckets: LeagueBucket[],
  blockedTeamId?: string | null,
): { leagueId: string; teamId: string } | null {
  for (const bucket of buckets) {
    const team = bucket.teams.find((entry) => entry.id !== blockedTeamId)
    if (team) return { leagueId: bucket.id, teamId: team.id }
  }
  return null
}

export function resolveTeamInLeague(
  buckets: LeagueBucket[],
  leagueId: string,
  teamId: string,
  blockedTeamId?: string | null,
): string {
  const bucket = buckets.find((entry) => entry.id === leagueId)
  if (!bucket) return teamId

  if (bucket.teams.some((team) => team.id === teamId && team.id !== blockedTeamId)) {
    return teamId
  }

  return bucket.teams.find((team) => team.id !== blockedTeamId)?.id ?? teamId
}

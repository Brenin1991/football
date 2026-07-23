import type { RosterSlot, Team } from '../../db/types'
import { getDatabase } from '../../db/database'
import { listRoster } from '../../db/queries'
import { derivePlayerOverall } from '../../db/playerAttributeDefaults'

function roleBucket(positionLabel: string): 'att' | 'mid' | 'def' {
  const pos = positionLabel.toUpperCase()
  if (pos === 'GK' || pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB') {
    return 'def'
  }
  if (pos === 'ST' || pos === 'CF' || pos === 'SS' || pos === 'LW' || pos === 'RW') {
    return 'att'
  }
  return 'mid'
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 65
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

export function deriveTeamRatingsFromRoster(roster: RosterSlot[]) {
  if (roster.length === 0) {
    return { att: 0, mid: 0, def: 0, chem: 0, stars: 0 }
  }

  const att: number[] = []
  const mid: number[] = []
  const def: number[] = []
  for (const slot of roster) {
    const ovr = slot.overall || derivePlayerOverall(slot.attributes, slot.positionLabel)
    const bucket = roleBucket(slot.positionLabel)
    if (bucket === 'att') att.push(ovr)
    else if (bucket === 'def') def.push(ovr)
    else mid.push(ovr)
  }

  const attR = avg(att.length ? att : mid)
  const midR = avg(mid.length ? mid : [...att, ...def])
  const defR = avg(def.length ? def : mid)
  const overalls = roster.map(
    (s) => s.overall || derivePlayerOverall(s.attributes, s.positionLabel),
  )
  const teamAvg = avg(overalls)
  // Química: coerência do elenco (desvio baixo = melhor)
  const variance =
    overalls.reduce((sum, o) => sum + (o - teamAvg) ** 2, 0) / Math.max(1, overalls.length)
  const chem = Math.max(60, Math.min(99, Math.round(92 - Math.sqrt(variance) * 1.8)))
  const stars = Math.max(1, Math.min(5, Math.round((teamAvg - 55) / 9)))

  return { att: attR, mid: midR, def: defR, chem, stars }
}

/** Ratings reais a partir do elenco no DB (não hash falso). */
export function deriveTeamRatings(team: Team | null) {
  if (!team) {
    return { att: 0, mid: 0, def: 0, chem: 0, stars: 0 }
  }
  try {
    const roster = listRoster(getDatabase(), team.id)
    return deriveTeamRatingsFromRoster(roster)
  } catch {
    return { att: 65, mid: 65, def: 65, chem: 70, stars: 3 }
  }
}

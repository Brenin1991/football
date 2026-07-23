/** Ratings 1–99. 65 = neutro no gameplay. */
export const PLAYER_ATTR_NEUTRAL = 65

export const PLAYER_ATTR_KEYS = [
  'pace',
  'acceleration',
  'stamina',
  'strength',
  'agility',
  'dribbling',
  'passing',
  'shotPower',
  'finishing',
  'tackling',
  'vision',
  'goalkeeping',
] as const

export type PlayerAttrKey = (typeof PLAYER_ATTR_KEYS)[number]

export type PlayerAttributes = Record<PlayerAttrKey, number>

export const PLAYER_ATTR_LABELS: Record<PlayerAttrKey, string> = {
  pace: 'Velocidade',
  acceleration: 'Aceleração',
  stamina: 'Stamina',
  strength: 'Força',
  agility: 'Agilidade / Giro',
  dribbling: 'Drible',
  passing: 'Passe',
  shotPower: 'Força do chute',
  finishing: 'Finalização',
  tackling: 'Desarme',
  vision: 'Visão',
  goalkeeping: 'Goleiro',
}

export function createDefaultPlayerAttributes(
  overrides: Partial<PlayerAttributes> = {},
): PlayerAttributes {
  const attrs = {} as PlayerAttributes
  for (const key of PLAYER_ATTR_KEYS) {
    attrs[key] = PLAYER_ATTR_NEUTRAL
  }
  return { ...attrs, ...overrides }
}

export function clampPlayerAttr(value: number): number {
  if (!Number.isFinite(value)) return PLAYER_ATTR_NEUTRAL
  return Math.max(1, Math.min(99, Math.round(value)))
}

export function clampPlayerAttributes(
  input: Partial<Record<PlayerAttrKey, number>> | null | undefined,
): PlayerAttributes {
  const base = createDefaultPlayerAttributes()
  if (!input) return base
  for (const key of PLAYER_ATTR_KEYS) {
    const raw = input[key]
    if (typeof raw === 'number') base[key] = clampPlayerAttr(raw)
  }
  return base
}

/** Overall ponderado simples para UI (1–99). */
export function derivePlayerOverall(attrs: PlayerAttributes, positionLabel?: string): number {
  const pos = (positionLabel ?? '').toUpperCase()
  const isGk = pos === 'GK' || pos.includes('GK')
  if (isGk) {
    return clampPlayerAttr(
      attrs.goalkeeping * 0.45 +
        attrs.vision * 0.12 +
        attrs.passing * 0.1 +
        attrs.strength * 0.1 +
        attrs.agility * 0.1 +
        attrs.stamina * 0.08 +
        attrs.pace * 0.05,
    )
  }
  if (pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB') {
    return clampPlayerAttr(
      attrs.tackling * 0.22 +
        attrs.strength * 0.16 +
        attrs.stamina * 0.12 +
        attrs.pace * 0.12 +
        attrs.passing * 0.1 +
        attrs.vision * 0.08 +
        attrs.agility * 0.08 +
        attrs.dribbling * 0.06 +
        attrs.acceleration * 0.06,
    )
  }
  if (pos === 'ST' || pos === 'CF' || pos === 'LW' || pos === 'RW') {
    return clampPlayerAttr(
      attrs.finishing * 0.22 +
        attrs.pace * 0.14 +
        attrs.shotPower * 0.12 +
        attrs.dribbling * 0.12 +
        attrs.acceleration * 0.1 +
        attrs.agility * 0.08 +
        attrs.passing * 0.08 +
        attrs.stamina * 0.07 +
        attrs.strength * 0.07,
    )
  }
  return clampPlayerAttr(
    attrs.passing * 0.16 +
      attrs.vision * 0.14 +
      attrs.stamina * 0.12 +
      attrs.dribbling * 0.12 +
      attrs.pace * 0.1 +
      attrs.acceleration * 0.08 +
      attrs.agility * 0.08 +
      attrs.tackling * 0.08 +
      attrs.shotPower * 0.06 +
      attrs.finishing * 0.06,
  )
}

export function resolveShirtNumber(opts: {
  rosterOverride: number | null | undefined
  preferred: number | null | undefined
  slotIndex: number
}): number {
  if (typeof opts.rosterOverride === 'number' && opts.rosterOverride >= 1 && opts.rosterOverride <= 99) {
    return Math.round(opts.rosterOverride)
  }
  if (typeof opts.preferred === 'number' && opts.preferred >= 1 && opts.preferred <= 99) {
    return Math.round(opts.preferred)
  }
  return Math.max(1, Math.min(99, opts.slotIndex + 1))
}

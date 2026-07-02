const shielding = new Set<string>()

/** RB segurado com a bola — protege e bloqueia roubo */
export function setBallShield(playerId: string, active: boolean) {
  if (active) shielding.add(playerId)
  else shielding.delete(playerId)
}

export function isBallShielding(playerId: string): boolean {
  return shielding.has(playerId)
}

export function clearBallShield(playerId: string) {
  shielding.delete(playerId)
}

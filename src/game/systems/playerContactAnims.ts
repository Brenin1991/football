/** Eventos de animação entre jogadores (roubo em pé → ombro / desequilíbrio). */

export type ContactAnimKind =
  | 'shoulder_charge'
  | 'end_shoulder_charge'
  | 'imbalance'
  | 'imbalance_stolen'

type ContactAnimRequest = {
  kind: ContactAnimKind
  until?: number
}

const pending = new Map<string, ContactAnimRequest>()

export function requestContactAnim(
  playerId: string,
  kind: ContactAnimKind,
  durationMs = 0,
) {
  const until = durationMs > 0 ? performance.now() + durationMs : undefined
  const prev = pending.get(playerId)

  // Roubo bem-sucedido / desequilíbrio tem prioridade sobre ombro
  if (
    prev &&
    (prev.kind === 'imbalance' || prev.kind === 'imbalance_stolen') &&
    (kind === 'shoulder_charge' || kind === 'end_shoulder_charge')
  ) {
    return
  }

  pending.set(playerId, { kind, until })
}

export function consumeContactAnim(playerId: string): ContactAnimKind | null {
  const req = pending.get(playerId)
  if (!req) return null

  if (req.kind === 'shoulder_charge') {
    // Mantém o pedido enquanto until não venceu (loop no Player)
    if (req.until != null && performance.now() > req.until) {
      pending.delete(playerId)
      return 'end_shoulder_charge'
    }
    return 'shoulder_charge'
  }

  pending.delete(playerId)
  return req.kind
}

export function clearContactAnim(playerId: string) {
  pending.delete(playerId)
}

export function peekContactAnim(playerId: string): ContactAnimKind | null {
  return pending.get(playerId)?.kind ?? null
}

import { useGameStore } from '../store/gameStore'

const HINTS: Record<string, string> = {
  shot: 'Solte para chutar',
  pass: 'Solte para passar',
  through: 'Solte para lançar',
  cross: 'Solte para cruzar',
}

export function ShotPowerBar() {
  const active = useGameStore((s) => s.shotChargeActive)
  const power = useGameStore((s) => s.shotChargePower)
  const mode = useGameStore((s) => s.powerBarMode)

  if (!active) return null

  const fillPct = power * 100
  const zone =
    power < 0.33 ? 'weak' : power < 0.66 ? 'mid' : 'strong'

  const label =
    mode === 'cross'
      ? 'Cruzamento'
      : mode === 'through'
        ? 'Profundidade'
        : mode === 'pass'
          ? 'Passe'
          : 'Força'

  const hint = mode ? HINTS[mode] ?? HINTS.shot : HINTS.shot

  return (
    <div className="shot-power pes-hud-surface" aria-hidden>
      <span className="shot-power-label">{label}</span>
      <div className="shot-power-track">
        <div className="shot-power-zones">
          <span className="zone weak" />
          <span className="zone mid" />
          <span className="zone strong" />
        </div>
        <div
          className={`shot-power-fill ${zone}`}
          style={{ height: `${fillPct}%` }}
        />
        <div className="shot-power-marker" style={{ bottom: `${fillPct}%` }} />
      </div>
      <span className="shot-power-hint">{hint}</span>
    </div>
  )
}

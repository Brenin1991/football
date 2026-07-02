import { useGameStore } from '../store/gameStore'

export function ShotPowerBar() {
  const active = useGameStore((s) => s.shotChargeActive)
  const power = useGameStore((s) => s.shotChargePower)

  if (!active) return null

  const fillPct = power * 100
  const zone =
    power < 0.33 ? 'weak' : power < 0.66 ? 'mid' : 'strong'

  return (
    <div className="shot-power pes-hud-surface" aria-hidden>
      <span className="shot-power-label">Força</span>
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
      <span className="shot-power-hint">Solte para chutar</span>
    </div>
  )
}

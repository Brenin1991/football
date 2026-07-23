import { useEffect, useState } from 'react'
import type { EditionPlayer, RosterSlot, TeamKit } from '../../db/types'
import { FORMATION_POSITION_LABELS } from '../../game/data/playerRoster'

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="ed-field ed-field--color">
      <span>{label}</span>
      <div className="ed-color-row">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          className="ed-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
    </label>
  )
}

export function KitEditor({
  label,
  kit,
  fallbackShirt,
  fallbackShorts,
  onChange,
}: {
  label: string
  kit?: TeamKit
  fallbackShirt: string
  fallbackShorts: string
  onChange: (data: { shirtColor: string; shortsColor: string; socksColor: string }) => void
}) {
  const shirt = kit?.shirtColor ?? fallbackShirt
  const shorts = kit?.shortsColor ?? fallbackShorts
  const socks = kit?.socksColor ?? shirt

  return (
    <div className="ed-kit">
      <div className="ed-kit__head">
        <h4>{label}</h4>
        <div className="ed-kit__swatches" aria-hidden>
          <span style={{ background: shirt }} />
          <span style={{ background: shorts }} />
          <span style={{ background: socks }} />
        </div>
      </div>
      <div className="ed-kit__grid">
        <ColorField
          label="Camisa"
          value={shirt}
          onChange={(v) => onChange({ shirtColor: v, shortsColor: shorts, socksColor: socks })}
        />
        <ColorField
          label="Calção"
          value={shorts}
          onChange={(v) => onChange({ shirtColor: shirt, shortsColor: v, socksColor: socks })}
        />
        <ColorField
          label="Meias"
          value={socks}
          onChange={(v) => onChange({ shirtColor: shirt, shortsColor: shorts, socksColor: v })}
        />
      </div>
    </div>
  )
}

export function RosterSlotRow({
  slotIndex,
  slot,
  editionPlayers,
  onAssign,
  onPosition,
  onShirtNumber,
}: {
  slotIndex: number
  slot?: RosterSlot
  editionPlayers: EditionPlayer[]
  onAssign: (playerId: string, position: string) => void
  onPosition: (position: string) => void
  onShirtNumber?: (shirtNumber: number | null) => void
}) {
  const position = slot?.positionLabel ?? FORMATION_POSITION_LABELS[slotIndex] ?? 'CM'
  const displayNumber = slot?.shirtNumber ?? slotIndex + 1
  const [shirtDraft, setShirtDraft] = useState(
    slot?.shirtNumberOverride?.toString() ?? '',
  )

  useEffect(() => {
    setShirtDraft(slot?.shirtNumberOverride?.toString() ?? '')
  }, [slot?.id, slot?.shirtNumberOverride, slotIndex])

  return (
    <div className="ed-roster-row">
      <span className="ed-roster-row__num" title={`Exibido: ${displayNumber}`}>
        {displayNumber}
      </span>
      <select
        className="ed-select"
        value={position}
        onChange={(e) => onPosition(e.target.value)}
      >
        {FORMATION_POSITION_LABELS.map((pos) => (
          <option key={pos} value={pos}>
            {pos}
          </option>
        ))}
      </select>
      <select
        className="ed-select"
        value={slot?.playerId ?? ''}
        onChange={(e) => {
          if (e.target.value) onAssign(e.target.value, position)
        }}
      >
        <option value="">Selecionar jogador…</option>
        {editionPlayers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {onShirtNumber ? (
        <input
          className="ed-input ed-input--shirt"
          type="number"
          min={1}
          max={99}
          placeholder="Nº"
          title="Número neste time (vazio = preferido/slot)"
          value={shirtDraft}
          onChange={(e) => setShirtDraft(e.target.value)}
          onBlur={() => {
            const raw = shirtDraft.trim()
            if (!raw) {
              if (slot?.shirtNumberOverride != null) onShirtNumber(null)
              return
            }
            const n = Math.max(1, Math.min(99, Math.round(Number(raw))))
            if (!Number.isFinite(n)) {
              setShirtDraft(slot?.shirtNumberOverride?.toString() ?? '')
              return
            }
            setShirtDraft(String(n))
            if (n !== slot?.shirtNumberOverride) onShirtNumber(n)
          }}
        />
      ) : null}
    </div>
  )
}

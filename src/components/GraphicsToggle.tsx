import { useGraphicsStore, type GraphicsMode } from '../store/graphicsStore'

export function GraphicsToggle({ className }: { className?: string }) {
  const mode = useGraphicsStore((s) => s.mode)
  const setMode = useGraphicsStore((s) => s.setMode)

  const select = (next: GraphicsMode) => {
    if (next !== mode) setMode(next)
  }

  return (
    <div className={className ?? 'graphics-toggle'} role="group" aria-label="Modo gráfico">
      <span className="graphics-toggle-label">Gráficos</span>
      <button
        type="button"
        className={`graphics-toggle-btn${mode === 'psx' ? ' active' : ''}`}
        aria-pressed={mode === 'psx'}
        onClick={() => select('psx')}
      >
        PSX
      </button>
      <button
        type="button"
        className={`graphics-toggle-btn ultra${mode === 'aaa' ? ' active' : ''}`}
        aria-pressed={mode === 'aaa'}
        onClick={() => select('aaa')}
      >
        AAA
      </button>
    </div>
  )
}

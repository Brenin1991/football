import {
  AAA_CANVAS_RESOLUTION_OPTIONS,
  type AaaCanvasResolutionId,
} from '../game/graphics/aaaSettings'
import { useGraphicsStore, type GraphicsMode } from '../store/graphicsStore'

export function GraphicsToggle({ className }: { className?: string }) {
  const mode = useGraphicsStore((s) => s.mode)
  const aaaResolution = useGraphicsStore((s) => s.aaaResolution)
  const setMode = useGraphicsStore((s) => s.setMode)
  const setAaaResolution = useGraphicsStore((s) => s.setAaaResolution)

  const select = (next: GraphicsMode) => {
    if (next !== mode) setMode(next)
  }

  return (
    <div className={className ?? 'graphics-toggle-wrap'}>
      <div className="graphics-toggle" role="group" aria-label="Modo gráfico">
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

      {mode === 'aaa' && (
        <label className="graphics-resolution-select">
          <span className="graphics-toggle-label">Resolução</span>
          <select
            value={aaaResolution}
            aria-label="Resolução do canvas"
            onChange={(e) =>
              setAaaResolution(e.target.value as AaaCanvasResolutionId)
            }
          >
            {(Object.keys(AAA_CANVAS_RESOLUTION_OPTIONS) as AaaCanvasResolutionId[]).map(
              (id) => (
                <option key={id} value={id} title={AAA_CANVAS_RESOLUTION_OPTIONS[id].description}>
                  {AAA_CANVAS_RESOLUTION_OPTIONS[id].label}
                </option>
              ),
            )}
          </select>
        </label>
      )}
    </div>
  )
}

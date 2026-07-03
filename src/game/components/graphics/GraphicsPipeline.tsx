import { useGraphicsStore } from '../../../store/graphicsStore'
import { AaaPipeline } from './AaaPipeline'
import { PsxPipeline } from './PsxPipeline'

/** Escolhe o pipeline de renderização conforme o modo gráfico */
export function GraphicsPipeline() {
  const mode = useGraphicsStore((s) => s.mode)
  return mode === 'aaa' ? <AaaPipeline /> : <PsxPipeline />
}

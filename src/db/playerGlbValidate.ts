import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Limite prático no browser (IndexedDB). */
export const MAX_PLAYER_GLB_BYTES = 80 * 1024 * 1024

const REQUIRED_CLIP_HINTS = ['player_idle', 'idle', 'player_run', 'run', 'player_walking']

export type PlayerGlbValidation = {
  ok: true
  fileName: string
  byteLength: number
  clipCount: number
  /** Buffer pronto pra gravar no IndexedDB */
  data: ArrayBuffer
}

/**
 * Valida .glb de jogador e devolve o ArrayBuffer (não consome o File duas vezes).
 */
export async function validatePlayerGlbFile(file: File): Promise<PlayerGlbValidation> {
  const name = file.name || 'model.glb'
  if (!name.toLowerCase().endsWith('.glb') && file.type !== 'model/gltf-binary') {
    throw new Error('Envie um arquivo .glb (mesmo formato do modelo padrão).')
  }
  if (file.size <= 0) throw new Error('Arquivo vazio.')
  if (file.size > MAX_PLAYER_GLB_BYTES) {
    throw new Error(`GLB muito grande (máx. ${Math.round(MAX_PLAYER_GLB_BYTES / (1024 * 1024))} MB).`)
  }

  const data = await file.arrayBuffer()
  if (data.byteLength < 64) throw new Error('Arquivo GLB inválido.')

  const loader = new GLTFLoader()
  const gltf = await new Promise<{ animations: { name: string }[]; scene: { children: unknown[] } }>(
    (resolve, reject) => {
      loader.parse(
        data.slice(0),
        '',
        (result) => resolve(result as { animations: { name: string }[]; scene: { children: unknown[] } }),
        (err) => reject(err instanceof Error ? err : new Error('GLB inválido ou corrompido.')),
      )
    },
  )

  if (!gltf.scene?.children?.length) {
    throw new Error('GLB sem malha. Exporte o personagem completo do Blender.')
  }
  if (!gltf.animations?.length) {
    throw new Error('GLB sem animações. Precisa das mesmas clips do modelo padrão (idle, run, etc.).')
  }

  const clipNames = gltf.animations.map((c) => c.name.toLowerCase())
  const hasLoco = REQUIRED_CLIP_HINTS.some((hint) =>
    clipNames.some((n) => n.includes(hint.toLowerCase())),
  )
  if (!hasLoco) {
    throw new Error(
      'Animações incompletas. Inclua pelo menos idle/run (mesmos nomes do player.glb padrão).',
    )
  }

  return {
    ok: true,
    fileName: name,
    byteLength: data.byteLength,
    clipCount: gltf.animations.length,
    data,
  }
}

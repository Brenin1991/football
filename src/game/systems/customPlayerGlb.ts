import { useGLTF } from '@react-three/drei'
import { getPlayerGlbBlob } from '../../db/playerGlbStore'

export const DEFAULT_PLAYER_GLB = '/models/player.glb'

/** playerId (edition) → blob: URL válida nesta sessão */
const urlByPlayerId = new Map<string, string>()

export function getCustomPlayerGlbUrl(playerId: string | null | undefined): string | null {
  if (!playerId) return null
  return urlByPlayerId.get(playerId) ?? null
}

export function getPlayerGlbUrl(playerId: string | null | undefined): string {
  return getCustomPlayerGlbUrl(playerId) ?? DEFAULT_PLAYER_GLB
}

function revokeUrl(playerId: string) {
  const prev = urlByPlayerId.get(playerId)
  if (prev) {
    URL.revokeObjectURL(prev)
    urlByPlayerId.delete(playerId)
  }
}

export function clearCustomPlayerGlbUrls() {
  for (const id of [...urlByPlayerId.keys()]) revokeUrl(id)
}

/**
 * Carrega blobs do IndexedDB e cria object URLs.
 * Tenta todos os IDs — quem não tiver GLB no IDB é ignorado.
 */
export async function hydrateCustomPlayerGlbs(playerIds: string[]): Promise<number> {
  const unique = [...new Set(playerIds.filter(Boolean))]
  let loaded = 0
  await Promise.all(
    unique.map(async (id) => {
      try {
        const blob = await getPlayerGlbBlob(id)
        if (!blob || blob.size < 64) {
          revokeUrl(id)
          return
        }
        revokeUrl(id)
        const url = URL.createObjectURL(blob)
        urlByPlayerId.set(id, url)
        useGLTF.preload(url)
        loaded += 1
      } catch (err) {
        console.warn('[customPlayerGlb] falha ao hidratar', id, err)
        revokeUrl(id)
      }
    }),
  )
  return loaded
}

import { getDatabase } from '../db/database'
import type { EntityImageType } from '../db/entityImages'
import { getEntityImage } from '../db/imageQueries'

const urlCache = new Map<string, string>()

function cacheKey(entityType: EntityImageType, entityId: string, updatedAt: number): string {
  return `${entityType}:${entityId}:${updatedAt}`
}

export function getEntityImageObjectUrl(
  entityType: EntityImageType,
  entityId: string,
): string | null {
  if (!entityId) return null
  try {
    const image = getEntityImage(getDatabase(), entityType, entityId)
    if (!image || image.data.byteLength === 0) return null

    const key = cacheKey(entityType, entityId, image.updatedAt)
    const cached = urlCache.get(key)
    if (cached) return cached

    for (const [k, url] of urlCache) {
      if (k.startsWith(`${entityType}:${entityId}:`)) {
        URL.revokeObjectURL(url)
        urlCache.delete(k)
      }
    }

    const blob = new Blob([image.data], { type: image.mimeType })
    const url = URL.createObjectURL(blob)
    urlCache.set(key, url)
    return url
  } catch {
    return null
  }
}

export function invalidateEntityImageCache(
  entityType?: EntityImageType,
  entityId?: string,
): void {
  for (const [key, url] of urlCache) {
    if (!entityType || key.startsWith(`${entityType}:${entityId ?? ''}`)) {
      URL.revokeObjectURL(url)
      urlCache.delete(key)
    }
  }
}

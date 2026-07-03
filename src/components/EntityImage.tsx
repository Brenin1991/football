import type { ReactNode } from 'react'
import { useMemo } from 'react'
import type { EntityImageType } from '../db/entityImages'
import { getEntityImageObjectUrl } from '../lib/entityImageCache'

type EntityImageProps = {
  entityType: EntityImageType
  entityId: string | null | undefined
  alt: string
  className?: string
  refreshKey?: number
  fallback?: ReactNode
}

export function EntityImage({
  entityType,
  entityId,
  alt,
  className = '',
  refreshKey = 0,
  fallback = null,
}: EntityImageProps) {
  const src = useMemo(() => {
    void refreshKey
    if (!entityId) return null
    return getEntityImageObjectUrl(entityType, entityId)
  }, [entityType, entityId, refreshKey])

  if (!src) {
    return fallback ? <>{fallback}</> : null
  }

  return <img src={src} alt={alt} className={className} draggable={false} />
}

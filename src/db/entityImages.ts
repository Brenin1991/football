export type EntityImageType = 'league' | 'team' | 'player'

export type StoredEntityImage = {
  entityType: EntityImageType
  entityId: string
  mimeType: string
  data: Uint8Array
  updatedAt: number
}

export const IMAGE_MAX_DIMENSION: Record<EntityImageType, number> = {
  league: 256,
  team: 256,
  player: 192,
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

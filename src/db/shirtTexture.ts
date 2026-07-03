export type ShirtUvLayout = {
  uvRepeatX: number
  uvRepeatY: number
  uvOffsetX: number
  uvOffsetY: number
  /** Espelha o PNG na horizontal antes de aplicar na malha. */
  flipHorizontal: boolean
}

export type TeamKitShirtRecord = {
  teamId: string
  kitNumber: 1 | 2
  mimeType: string | null
  data: Uint8Array | null
  uv: ShirtUvLayout
}

export const DEFAULT_SHIRT_UV: ShirtUvLayout = {
  uvRepeatX: 1,
  uvRepeatY: 1,
  uvOffsetX: 0,
  uvOffsetY: 0,
  flipHorizontal: true,
}

export function cloneShirtUv(uv: ShirtUvLayout): ShirtUvLayout {
  return { ...uv }
}

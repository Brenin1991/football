export const SKIN_TONE_PRESETS = {
  porcelain: '#f5ddd0',
  light: '#e8c4a8',
  wheat: '#d4a574',
  medium: '#c68663',
  olive: '#a67c52',
  brown: '#8d5524',
  dark: '#5c3a21',
  deep: '#3d2914',
} as const

export type SkinToneId = keyof typeof SKIN_TONE_PRESETS

export const SKIN_TONE_OPTIONS: { id: SkinToneId; label: string }[] = [
  { id: 'porcelain', label: 'Porcelana' },
  { id: 'light', label: 'Clara' },
  { id: 'wheat', label: 'Trigo' },
  { id: 'medium', label: 'Média' },
  { id: 'olive', label: 'Oliva' },
  { id: 'brown', label: 'Morena' },
  { id: 'dark', label: 'Escura' },
  { id: 'deep', label: 'Profunda' },
]

export function getSkinToneColor(id: string): string {
  return SKIN_TONE_PRESETS[id as SkinToneId] ?? SKIN_TONE_PRESETS.medium
}

export function isSkinToneId(id: string): id is SkinToneId {
  return id in SKIN_TONE_PRESETS
}

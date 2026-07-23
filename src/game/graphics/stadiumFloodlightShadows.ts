/**
 * 4 DirectionalLights nos cantos do estádio com shadow map —
 * X de refletores estilo PES (caro, mas “certo”).
 */
export const STADIUM_FLOODLIGHT_SHADOWS = {
  enabled: false,
  /** Sol/key deixa de castar sombra — o X vem só das 4 torres */
  disableKeyShadow: true,
  /** Intensidade de cada torre */
  intensity: 1.62,
  color: '#fff1d6',
  /** Altura das torres (m, mundo) */
  height: 38,
  /** Distância horizontal = half-extent do campo × fator */
  radiusMul: 1.18,
  /** Shadow map por torre (4×) — 512/1024 pra caber no orçamento */
  mapSize: 1024,
  bias: -0.00045,
  normalBias: 0.04,
  /** Sombra dura (PES) */
  hardShadows: true,
  nearestFilter: true,
  /** Pad do frustum no campo */
  frustumPad: 1.35,
} as const

export type StadiumFloodlightShadowSettings = typeof STADIUM_FLOODLIGHT_SHADOWS

export function stadiumFloodlightsActive(): boolean {
  return STADIUM_FLOODLIGHT_SHADOWS.enabled
}

export function keyLightCastsShadow(fallbackEnabled: boolean): boolean {
  if (!STADIUM_FLOODLIGHT_SHADOWS.enabled) return fallbackEnabled
  if (STADIUM_FLOODLIGHT_SHADOWS.disableKeyShadow) return false
  return fallbackEnabled
}

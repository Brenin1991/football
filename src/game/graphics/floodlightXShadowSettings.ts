import { FIELD_SCALE } from '../systems/fieldData'

/**
 * Híbrido PES 6: 1 shadow map real (sol/key) + 3 braços fake em X
 * a partir dos cantos do estádio (refletores).
 *
 * Posição do sol deve bater com AaaPipeline / PsxPipeline.
 */
export const KEY_LIGHT_LOCAL = {
  x: 18,
  y: 28,
  z: 12,
} as const

export function getKeyLightWorldPosition(): { x: number; y: number; z: number } {
  return {
    x: KEY_LIGHT_LOCAL.x * FIELD_SCALE,
    y: KEY_LIGHT_LOCAL.y * FIELD_SCALE,
    z: KEY_LIGHT_LOCAL.z * FIELD_SCALE,
  }
}

export const FLOODLIGHT_X_SHADOWS = {
  enabled: true,
  /** Braços fake (o 4º fica com o shadow map do sol) */
  fakeArmCount: 4,
  /** Torres nos cantos — raio = half-extent do campo × este fator */
  towerRadiusMul: 1.02,
  /** Comprimento do braço no gramado (m) */
  length: 1.6,
  /** Largura na base (m) */
  width: 0.42,
  /** Altura acima do gramado — evita z-fight */
  yBias: 0.04,
  opacity: 0.35,
  color: '#061008',
  /** Inclui a bola */
  includeBall: true,
  /** Braço da bola um pouco menor */
  ballLengthMul: 0.15,
  ballWidthMul: 0.15,
  /** Máx. de jogadores + bola */
  maxAnchors: 24,
  /**
   * Micro-sombras por membro (PES 6) — cada braço do X repete pé esq/dir + tronco.
   * O 4º braço continua sendo o shadow map do sol.
   */
  microShadows: {
    enabled: true,
    footLength: 0.36,
    footWidth: 0.13,
    torsoLength: 0.82,
    torsoWidth: 0.26,
    /** Opacidade relativa ao braço base */
    footOpacityMul: 0.92,
    torsoOpacityMul: 0.78,
  },
} as const

export type FloodlightXShadowSettings = typeof FLOODLIGHT_X_SHADOWS

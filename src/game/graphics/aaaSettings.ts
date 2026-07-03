import * as THREE from 'three'

/** Preset visual AAA — PBR vivo, iluminação de tarde ensolarada */
export const AAA_CLASSIC = {
  renderer: {
    dprMin: 1,
    dprMax: 2,
    antialias: true,
  },

  toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
  toneMappingExposure: 1.28,

  fog: {
    color: '#b8d4ec',
    near: 55,
    far: 280,
  },

  background: '#9ec5e8',

  environment: {
    preset: 'sunset' as const,
    intensity: 0.58,
  },

  shadow: {
    enabled: true,
    mapSize: 2048,
    bias: -0.00035,
    normalBias: 0.035,
  },

  lighting: {
    ambient: 0.34,
    hemisphereSky: '#dcecff',
    hemisphereGround: '#4a8f48',
    hemisphereIntensity: 0.52,
    sunColor: '#fff3d6',
    sunIntensity: 2.05,
    fillColor: '#c8e0ff',
    fillIntensity: 0.38,
  },

  material: {
    envMapIntensity: 0.42,
    fabricRoughness: 0.86,
    skinRoughness: 0.82,
    /** Leve emissivo nas cores do uniforme — mantém vivacidade sem brilho plástico */
    kitEmissiveScale: 0.045,
    kitEmissiveIntensity: 0.62,
    colorSaturationBoost: 1.14,
    colorLightnessBoost: 1.06,
  },

  post: {
    bloomIntensity: 0.14,
    bloomThreshold: 0.88,
    bloomSmoothing: 0.35,
    multisampling: 4,
    saturation: 0.22,
    contrast: 0.1,
    brightness: 0.03,
  },
}

export type AaaSettings = typeof AAA_CLASSIC

/** Deixa cores de uniforme/gramado mais vivas sem estourar o HDR */
export function boostAaaColor(color: THREE.Color): THREE.Color {
  const { colorSaturationBoost, colorLightnessBoost } = AAA_CLASSIC.material
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl)
  const out = new THREE.Color()
  out.setHSL(
    hsl.h,
    Math.min(1, hsl.s * colorSaturationBoost + 0.03),
    Math.min(1, hsl.l * colorLightnessBoost),
  )
  return out
}

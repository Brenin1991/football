import * as THREE from 'three'
import type { PsxToneMapping } from '../psx/psxSettings'

/** Presets de resolução do canvas (DPR min/max do React Three Fiber) */
export const AAA_CANVAS_RESOLUTION_OPTIONS = {
  native: {
    label: 'Nativa',
    description: 'Usa a resolução da tela (até 2× DPR)',
    dprMin: 1,
    dprMax: 2,
  },
  high: {
    label: 'Alta',
    description: 'Detalhe alto com custo moderado',
    dprMin: 4.25,
    dprMax: 5.75,
  },
  medium: {
    label: 'Média',
    description: 'Equilíbrio entre nitidez e FPS',
    dprMin: 0.9,
    dprMax: 1.25,
  },
  low: {
    label: 'Baixa',
    description: 'Mais FPS, imagem mais suave',
    dprMin: 0.65,
    dprMax: 1,
  },
  '720p': {
    label: '720p',
    description: '~50% da resolução nativa',
    dprMin: 0.5,
    dprMax: 0.72,
  },
} as const

export type AaaCanvasResolutionId = keyof typeof AAA_CANVAS_RESOLUTION_OPTIONS

export const AAA_CANVAS_RESOLUTION_DEFAULT: AaaCanvasResolutionId = 'native'

export function getAaaCanvasResolution(
  id: AaaCanvasResolutionId = AAA_CANVAS_RESOLUTION_DEFAULT,
) {
  return AAA_CANVAS_RESOLUTION_OPTIONS[id] ?? AAA_CANVAS_RESOLUTION_OPTIONS.native
}

export function getAaaCanvasDpr(
  id: AaaCanvasResolutionId = AAA_CANVAS_RESOLUTION_DEFAULT,
): [number, number] {
  const opt = getAaaCanvasResolution(id)
  return [opt.dprMin, opt.dprMax]
}

/** Preset visual AAA — PBR vivo, iluminação de tarde ensolarada */
export const AAA_CLASSIC = {
  renderer: {
    antialias: true,
    /** Preset ativo — altere aqui ou via menu (graphicsStore.aaaResolution) */
    resolution: AAA_CANVAS_RESOLUTION_DEFAULT satisfies AaaCanvasResolutionId,
  },

  fog: {
    color: '#b8d4ec',
    near: 55,
    far: 280,
  },

  background: '#9ec5e8',

  environment: {
    enabled: true,
    intensity: 0.2,
  },

  reflectionProbe: {
    enabled: true,
    resolution: 512,
    frames: 1,
    /** Altura do probe acima do gramado */
    height: 1.5,
  },

  shadow: {
    enabled: true,
    mapSize: 4096,
    bias: -0.00035,
    normalBias: 0.035,
  },

  lighting: {
    ambient: 0.14,
    hemisphereSky: '#dcecff',
    hemisphereGround: '#4a8f48',
    hemisphereIntensity: 0.52,
    sunColor: '#fff3d6',
    sunIntensity: 2.5,
    fillColor: '#c8e0ff',
    fillIntensity: 0.38,
  },

  material: {
    envMapIntensity: 0.42,
    fabricRoughness: 1,
    skinRoughness: 1,
    /** Leve emissivo nas cores do uniforme — mantém vivacidade sem brilho plástico */
    kitEmissiveScale: 0.045,
    kitEmissiveIntensity: 0.62,
    colorSaturationBoost: 1.14,
    colorLightnessBoost: 1.06,
  },

  /**
   * Cor / HDR (pós-processo — igual ao PSX, sem pixel/dither/scanlines)
   */
  color: {
    exposure: 2,
    brightness: 0.01,
    contrast: 1,
    saturation: 1,
    gamma: 1,
    vignette: 0.4,
    vignetteDarkness: 1.55,
    tint: [1.0, 1.0, 1.0] as [number, number, number],
    toneMapping: 'aces' as PsxToneMapping,
  },

  post: {
    temporalAA: {
      enabled: false,
      sampleLevel: 1,
      unbiased: true,
      motionPositionThreshold: 0.003,
      motionRotationThreshold: 0.0012,
    },
    ambientOcclusion: {
      enabled: false,
      kernelRadius: 8,
      minDistance: 0.005,
      maxDistance: 0.1,
      output: 'default' as 'default' | 'ssao' | 'blur' | 'depth' | 'normal',
      ignoreAlpha: true,
    },
    ssr: {
      enabled: false,
      opacity: 0.72,
      maxDistance: 36,
      thickness: 0.9,
    },
    rgbShift: {
      enabled: true,
      amount: 0.0008,
      angle: 0,
    },
    contactShadows: {
      enabled: true,
      strength: 0.24,
      radius: 1.8,
      threshold: 0.1,
      lowerScreenBoost: 0.35,
    },
    screenSpaceLight: {
      enabled: false,
      intensity: 0.22,
      threshold: 0.62,
      shadowStrength: 0.18,
      radius: 0.28,
      centerX: 0.5,
      centerY: 0.42,
    },
    bloomFog: {
      enabled: true,
      threshold: 0.62,
      softKnee: 0.22,
      glowStrength: 0.4,
      fogTintMix: 0.7,
      radiusPx: 3.5,
      outerRadiusMul: 2.2,
      veilStrength: 0.08,
      fogColor: '#bfbfbf',
    },
    chromaticDirt: {
      enabled: true,
      amount: 0.00012,
      radialStrength: 0.6,
      dirtStrength: 0.16,
      dirtScale: 1.7,
      dirtThreshold: 0.85,
      centerX: 0.5,
      centerY: 0.5,
    },
    bloom: {
      intensity: 0.44,
      threshold: 0.88,
      radius: 0.5,
    },
    motionBlur: {
      enabled: false,
      strength: 0.5,
      rotationScale: 3.2,
      translationScale: 0.0025,
      maxBlurUv: 0.04,
    },
    filmGrain: {
      enabled: true,
      intensity: 0.022,
    },
    colorGrade: {
      hdrExposure: 1.5,
      brightness: 0.01,
      contrast: 1,
      saturation: 1,
      gamma: 1,
      hueShift: 0,
      colorCorrection: [1, 1, 1] as [number, number, number],
      colorMultiply: '#ffffff',
      tintColor: '#c8d4ff',
      tintStrength: 0,
      vignette: 0.4,
      sharpen: 0.35,
      rgbShift: { amount: 0.0008, angle: 0 },
    },
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

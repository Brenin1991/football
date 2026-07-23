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
    description: 'Supersampling de alta qualidade (até 2,25× DPR)',
    dprMin: 1.5,
    dprMax: 2.25,
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
    precision: 'highp' as const,
    powerPreference: 'high-performance' as const,
    alpha: false,
    premultipliedAlpha: false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
    /** MSAA no render target HDR do EffectComposer (WebGL2). */
    multisampling: 4,
    /** RGBA16F preserva highlights para bloom e tone mapping. */
    hdr: true,
    /** Limite desejado; será limitado pela capacidade real da GPU. */
    maxAnisotropy: 16,
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
    intensity: 0.6,
  },

  reflectionProbe: {
    enabled: true,
    resolution: 1024,
    frames: 1,
    /** Altura do probe acima do gramado */
    height: 1,
  },

  shadow: {
    enabled: true,
    type: 'pcfsoft' as const,
    /** 8K — cobre estádio inteiro sem perder nitidez no gramado */
    mapSize: 8192,
    bias: -0.00035,
    normalBias: 0.035,
  },

  lighting: {
    ambient: 0.2,
    hemisphereSky: '#dcecff',
    hemisphereGround: '#8e722b',
    hemisphereIntensity: 0.3,
    sunColor: '#edb737',
    sunIntensity: 1.3,
    fillColor: '#c8e0ff',
    fillIntensity: 0.1,
  },

  material: {
    envMapIntensity: 1.42,
    fabricRoughness: 1,
    skinRoughness: 1,
    /** Leve emissivo nas cores do uniforme — mantém vivacidade sem brilho plástico */
    kitEmissiveScale: 0.045,
    kitEmissiveIntensity: 0.62,
    colorSaturationBoost: 1.14,
    colorLightnessBoost: 1.06,
  },

  /** Gramado procedural aplicado somente ao mesh `field_area`. */
  grass: {
    enabled: true,
    /** Densidade do relevo de fibras por unidade do mundo. */
    bladeScale: 40,
    /** Alongamento visual dos fios no sentido do corte. */
    bladeAspect: 1,
    /** Variação maior que agrupa os fios em pequenos tufos. */
    clumpScale: 0.8,
    roughness: 0.9,
    roughnessVariation: 0.08,
    microNormalStrength: 0.08,
    /** Faixas de corte afetam só a roughness, nunca a cor. */
    mowingStripeWidth: 1.1,
    mowingRoughnessVariation: 0.1,
    /** Remove detalhe subpixel gradualmente para impedir moiré/cintilação. */
    distanceFadeStart: 0.78,
    distanceFadeEnd: 0.1,
    /** Camadas geométricas que formam volume e silhueta de fios reais. */
    physical: {
      enabled: false,
      shellCount: 10,
      height: 0.0025,
      bladeScale: 58,
      bladeAspect: 1,
      density: 0.44,
      fadeStart: 18,
      fadeEnd: 72,
      alphaTest: 0.48,
    },
  },

  /**
   * Estágio HDR de saída — aplicado pelo renderer/OutputPass no fim da cadeia.
   * O color grade (contraste, saturação, vinheta, tint…) fica em `post.colorGrade`.
   */
  color: {
    /** Exposição do tone mapping, aplicada junto ao ACES no OutputPass. */
    exposure: 0.9,
    /** none | linear | reinhard | cineon | aces | agx */
    toneMapping: 'aces' as PsxToneMapping,
  },

  post: {
    temporalAA: {
      /** MSAA 4× é mais estável em jogo; TAA causa ghosting em atletas/bola. */
      enabled: false,
      sampleLevel: 1,
      unbiased: true,
      motionPositionThreshold: 0.003,
      motionRotationThreshold: 0.0012,
    },
    ambientOcclusion: {
      enabled: false,
      kernelRadius: 8,
      minDistance: 0.025,
      maxDistance: 0.85,
      output: 'default' as 'default' | 'ssao' | 'blur' | 'depth' | 'normal',
      ignoreAlpha: true,
    },
    ssr: {
      enabled: false,
      opacity: 0.2,
      maxDistance: 36,
      thickness: 0.1,
    },
    rgbShift: {
      enabled: true,
      amount: 0.0008,
      angle: 0,
    },
    contactShadows: {
      enabled: true,
      strength: 0.3,
      radius: 1.55,
      threshold: 0.12,
      lowerScreenBoost: 0.26,
    },
    screenSpaceLight: {
      enabled: false,
      intensity: 1.9,
      threshold: 0.72,
      shadowStrength: 0.07,
      radius: 0.24,
      centerX: 0.5,
      centerY: 0.42,
    },
    bloomFog: {
      enabled: true,
      threshold: 0.78,
      softKnee: 0.08,
      glowStrength: 0.22,
      fogTintMix: 0.42,
      radiusPx: 5,
      outerRadiusMul: 8,
      veilStrength: 0.035,
      fogColor: '#c8d8e6',
    },
    chromaticDirt: {
      enabled: false,
      amount: 0.00012,
      radialStrength: 0.6,
      dirtStrength: 0.16,
      dirtScale: 1.7,
      dirtThreshold: 0.85,
      centerX: 0.5,
      centerY: 0.5,
    },
    bloom: {
      intensity: 0.2,
      threshold: 0.6,
      radius: 0.6,
    },
    motionBlur: {
      enabled: true,
      strength: 0.1,
      rotationScale: 1.2,
      translationScale: 0.0025,
      maxBlurUv: 0.04,
    },
    filmGrain: {
      enabled: true,
      intensity: 0.008,
    },
    /** DoF leve em cutscenes (hino / comemoração / replay) — ativado em runtime */
    depthOfField: {
      aperture: 0.00022,
      maxblur: 0.0055,
      focusFallback: 4.4,
    },
    colorGrade: {
      /** Mantido neutro: a exposição HDR ocorre uma única vez no OutputPass. */
      hdrExposure: 0.8,
      brightness: 0.01,
      contrast: 1.1,
      saturation: 1.1,
      gamma: 1.2,
      hueShift: 0,
      colorCorrection: [1, 1, 1] as [number, number, number],
      colorMultiply: '#ffffff',
      tintColor: '#dce9ff',
      tintStrength: 0.025,
      vignette: 0.18,
      sharpen: 0.22,
      rgbShift: { amount: 0, angle: 0 },
    },
  },
}

export type AaaSettings = typeof AAA_CLASSIC

/** Deixa cores de uniforme/gramado mais vivas sem estourar o HDR */
export function boostAaaColor(color: THREE.Color): THREE.Color {
  return color.multiplyScalar(1.1)
}

/**
 * Configuração visual PSX — edite só este arquivo.
 *
 * post     → efeitos retro (pixel, dither, scanlines)
 * color    → brilho, contraste, saturação, HDR/exposição
 * material → snap de vértice, flat shading, texturas 64/128, distorção afim
 * renderer → canvas (dpr, antialias)
 * fog      → névoa e céu
 */
export type PsxTextureProfile = {
  /** Mapeamento afim PS1 — evite em superfícies grandes (gramado) */
  affine?: boolean
  /** 0–1 multiplicador do wobble global */
  wobble?: number
}

export type PsxToneMapping = 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces' | 'agx'

export const PSX_CLASSIC = {
  /** Efeitos retro na tela */
  post: {
    pixelSize: 0.9,
    resolutionScale: 0.7,
    colorDepth: 32,
    ditherIntensity: 0.4,
    bands: 16,
    bandIntensity: 0.2,
    scanOpacity: 0,
    scanCount: 256,
    uvJitter: 0.0001,
    /** Bloom: intensidade/threshold/smoothing para brilho/glow */
    bloom: {
      intensity: 0.14,
      threshold: 0.88,
      smoothing: 0.35,
      radius: 0.5,
      mipmapBlur: false,
    },
  },

  /**
   * Cor / HDR (aplicado no pós-processo — EffectComposer ignora o renderer)
   * exposure + toneMapping → ACES, AGX, Reinhard, etc.
   */
  color: {
    /** Exposição HDR. 1 = neutro, 1.5–2.5 = mais claro */
    exposure: 3,
    /** Brilho aditivo na tela final (-0.4 a 0.4) */
    brightness: 0.01,
    /** Contraste. 1 = neutro, 1.2 = mais punch, 0.8 = lavado */
    contrast: 1,
    /** Saturação. 0 = P&B, 1 = neutro, 1.3 = mais vivo */
    saturation: 1.5,
    /** Gamma / curva. 1 = neutro, 1.1 = midtones mais escuros */
    gamma: 1,
    /** Vinheta nas bordas (0 = off, 0.3 = forte) */
    vignette: 0.4,
    /** Escurecimento da vinheta (0–1) */
    vignetteDarkness: 1.55,
    /** Matiz RGB — multiplicador por canal [R, G, B]. Ex: [1.05, 1, 0.95] = quente */
    tint: [1.0, 1.0, 1.0] as [number, number, number],
    /**
     * Tone mapping HDR (pós-processo):
     * none | linear | reinhard | cineon | aces | agx
     */
    toneMapping: 'aces' as PsxToneMapping,
  },

  /** Materiais 3D */
  material: {
    vertexSnap: 32,
    playerVertexSnap: 128,
    flatShading: true,
    /** Texturas estilo PS1 */
    texture: {
      /** Resolução máxima (64 ou 128 px no maior lado) */
      maxSize: 2048,
      /** Mapeamento afim — só recomendado em meshes pequenos (jogadores) */
      affine: true,
      /** Wobble animado nas UVs (0 = desligado) */
      wobbleIntensity: 0.5,
      wobbleSpeed: 3.5,
      wobbleFrequency: 12,
      /** Campo: sem afim/wobble (polígonos grandes deformam demais) */
      field: { affine: false, wobble: 0 } satisfies PsxTextureProfile,
      /** Jogadores: afim leve, sem wobble por padrão */
      character: { affine: true, wobble: 0.25 } satisfies PsxTextureProfile,
    },
  },

  /** Canvas */
  renderer: {
    dprMin: 1,
    dprMax: 1.5,
    antialias: false,
  },

  /** Atmosfera */
  fog: { color: '#c9a206', near: 15, far: 150 },
  background: '#ffc002',

  /** Sombras — mapSize baixo + basic + nearest = blocos estilo PS1 */
  shadow: {
    enabled: true,
    /** basic = dura/pixelada | pcf | pcfsoft = suave */
    mapType: 'basic' as 'basic' | 'pcf' | 'pcfsoft',
    /** Menor = sombras mais blocadas (256–512 recomendado) */
    mapSize: 1024,
    bias: -0.0002,
    normalBias: 0.01,
    /** Sem suavização na textura do shadow map */
    nearestFilter: true,
    /** Jogadores e árbitro */
    players: { cast: true, receive: true },
  },
}

export type PsxSettings = typeof PSX_CLASSIC

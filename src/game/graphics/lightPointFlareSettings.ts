/** Postes/refletores do estádio (nós `light_*` no field.glb) */
export const LIGHT_POINT_FLARES = {
  enabled: false,
  nodeNameIncludes: 'light_01',
  texturePath: '/textures/light_glow.png',
  color: '#ffffff',
  opacity: 1,
  billboardScale: 10.2,
  depthTest: true,
  toneMapped: true,
  ignoreSceneFog: true,
  /** <= 0 = refletores sempre ligados */
  daylightOffThreshold: -1,
  daylightFadeRange: 0.08,
  usePointLight: true,
  useRealSpots: true,
  pointLight: {
    enabled: false,
    color: '#ffffff',
    intensity: 100,
    distance: 208,
    decay: 2,
  },
  spotLight: {
    enabled: false,
    color: '#ffffff',
    intensity: 100,
    distance: 202,
    angle: 100.32,
    penumbra: 0.38,
    decay: 2,
    castShadow: false,
    targetLocal: [0, 0, 0] as [number, number, number],
  },
  flare: {
    enabled: true,
  },
  volumetric: {
    enabled: false,
    /** Cor do feixe — mais escura evita estourar para branco no HDR/bloom */
    color: '#c87828',
    length: 22,
    radius: 5.5,
    radialSegments: 16,
    heightSegments: 8,
    strength: 0.16,
    heightFalloff: 2.4,
    noiseScale: 1.8,
    noiseScroll: 0.2,
    depthTest: true,
    ignoreSceneFog: true,
    renderOrder: 12,
  },
  distanceCulling: {
    enabled: false,
    maxDistance: 55,
    fadeStartDistance: 32,
    updateHz: 4,
    maxSimultaneousSpots: 0,
  },
}

export type LightPointFlareSettings = typeof LIGHT_POINT_FLARES

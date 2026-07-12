/** Torcida nos nós `cheering_area*` — billboard para câmera (como flares de luz) */
export const STADIUM_CROWD = {
  enabled: true,
  texturePath: '/textures/green_screen_crowd_cheering.gif',
  /** GIF animado — atualiza via canvas a cada frame */
  animated: true,
  nodeNameIncludes: 'cheering_area',
  /** Altura real de um painel (torcedores em pé ~1,75 m) */
  personHeight: 2.95,
  /** Máximo de painéis na arquibancada — 0 = sem limite */
  maxPanels: 200,
  /** Sobreposição leve entre painéis (0–1) */
  tileOverlap: 10.96,
  /** Distância da superfície do cheering_area para evitar z-fighting */
  surfaceOffset: 0.1,
  depthTest: true,
  depthWrite: true,
  toneMapped: true,
  hideAnchorMesh: true,
  renderOrder: 2,
  /** Chroma key verde do GIF */
  chromaKey: {
    enabled: true,
    /** gb = g - max(r,b); acima disso começa a cortar */
    threshold: 0.01,
    /** faixa suave de borda do key */
    smoothness: 0.1,
    /** mínimo de verde para considerar fundo */
    minGreen: 0.02,
  },
  /** Flash de câmera aleatório na torcida (billboard como os flares de luz) */
  cameraFlash: {
    enabled: true,
    texturePath: '/textures/cheering_flash.png',
    maxActive: 18,
    /** segundos entre flashes por slot */
    minWait: 0.25,
    maxWait: 1.8,
    /** duração do pisca */
    minDuration: 0.06,
    maxDuration: 0.2,
    maxOpacity: 1.15,
    /** tamanho do flare em metros */
    size: 2.1,
    renderOrder: 990,
    depthTest: false,
    blackKeyThreshold: 0.06,
  },
}

export type StadiumCrowdSettings = typeof STADIUM_CROWD

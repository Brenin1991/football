import * as THREE from 'three'
import type { FieldBounds } from '../types'
import { PLAYER_HEIGHT } from '../constants'
import { FIELD_SCALE, getPitchGroundY } from './fieldData'
import { getAnthemLineLayout } from './anthemLine'

const S = FIELD_SCALE
const HS = Math.sqrt(S)

/** Rosto relativo ao chão do campo */
const FACE_Y = PLAYER_HEIGHT * 0.88
const INTRO_FOV_WIDE = 46
/** Hino: bem fechado nos rostos; abre um pouco no final estilo TV */
const INTRO_FOV_ANTHEM = 24
const INTRO_FOV_ANTHEM_END = 29

/** Dolly bem lento na linha do hino */
export const ANTHEM_SHOT_DURATION = 48

export interface IntroCamCtx {
  elapsed: number
  progress: number
  bounds: FieldBounds
}

type ShotSample = (u: number, ctx: IntroCamCtx, pos: THREE.Vector3, look: THREE.Vector3) => void

interface IntroShot {
  duration: number
  fov: number
  sample: ShotSample
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function smoothstep(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

function easeInOut(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

/** Progresso do dolly — mais tempo no começo/meio (rostos) */
function anthemDollyProgress(u: number) {
  const x = THREE.MathUtils.clamp(u, 0, 1)
  // Curva suave e “preguiçosa”: avança menos no início
  return easeInOut(Math.pow(x, 1.15))
}

/** Micro balanço de cameraman — bem leve */
function handheldOffset(
  elapsed: number,
  strength: number,
  out: { x: number; y: number; z: number },
) {
  const s = strength
  out.x =
    Math.sin(elapsed * 1.35) * 0.018 * s +
    Math.sin(elapsed * 2.7 + 0.4) * 0.008 * s
  out.y =
    Math.sin(elapsed * 1.9 + 1.1) * 0.012 * s +
    Math.sin(elapsed * 3.1) * 0.005 * s
  out.z =
    Math.sin(elapsed * 1.55 + 0.7) * 0.022 * s +
    Math.cos(elapsed * 2.4 + 0.2) * 0.01 * s
}

const _hand = { x: 0, y: 0, z: 0 }
const _lookHand = { x: 0, y: 0, z: 0 }

/**
 * Hino estilo TV:
 * - maior parte: dolly lento ~45°, bem perto dos rostos
 * - final (~28%): sobe, abre um pouco e gira pra mais de frente (crane/orbit)
 */
function sampleAnthemFaces(
  u: number,
  elapsed: number,
  bounds: FieldBounds,
  pos: THREE.Vector3,
  look: THREE.Vector3,
) {
  const line = getAnthemLineLayout(bounds)
  const p = anthemDollyProgress(u)
  const focusZ = lerp(line.startZ, line.endZ, p)
  const ground = getPitchGroundY()

  // 0 → 1 a partir de ~72% do shot
  const endBlend = smoothstep((u - 0.72) / 0.28)

  // Começo: perto e diagonal; final: afasta, sobe e fica mais de frente
  const sideDist = lerp(1.05, 1.85, endBlend)
  const backDist = lerp(0.88, 0.28, endBlend)
  const camY = ground + lerp(FACE_Y * 0.55, FACE_Y * 1.05, endBlend)

  // Orbit leve no final (gira o ponto de vista em volta do foco)
  const orbit = endBlend * 0.55
  const sideX = -sideDist * Math.cos(orbit) - backDist * Math.sin(orbit) * 0.35
  const sideZ = -backDist * Math.cos(orbit) + sideDist * Math.sin(orbit) * 0.45

  handheldOffset(elapsed, lerp(0.55, 0.75, endBlend), _hand)
  handheldOffset(elapsed * 0.85 + 1.3, lerp(0.3, 0.45, endBlend), _lookHand)

  pos.set(
    line.lineX + sideX + _hand.x,
    camY + _hand.y,
    focusZ + sideZ + _hand.z,
  )

  // Mira nos rostos; no final olha um pouco mais o grupo (não um só)
  const lookAhead = lerp(0.35, 0.85, endBlend)
  look.set(
    line.lineX + lerp(0.12, 0.28, endBlend) + _lookHand.x,
    ground + FACE_Y * lerp(0.95, 0.88, endBlend) + _lookHand.y * 0.35,
    focusZ + lookAhead + _lookHand.z,
  )
}

/**
 * Intro estilo PES 6 — cortes escondidos por fade preto.
 */
const INTRO_SHOTS: IntroShot[] = [
  // 1 — Panorâmica lenta no chão
  {
    duration: 19,
    fov: INTRO_FOV_WIDE,
    sample(u, { bounds, elapsed }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = easeInOut(u)
      handheldOffset(elapsed, 0.45, _hand)
      pos.set(
        bounds.minX - lerp(3.6, 2.8, t) * S + _hand.x,
        lerp(1.05, 1.35, t) * HS + _hand.y,
        lerp(bounds.minZ - 3.2 * S, bounds.maxZ + 2.2 * S, t) + _hand.z,
      )
      look.set(
        cx + lerp(-2, 0.2, t) * S,
        lerp(1.5, 2.2, t),
        cz + lerp(-5.5, 4.5, t) * S,
      )
    },
  },
  // 2 — Da arquibancada (não em cima do centro), mais lenta
  {
    duration: 9.5,
    fov: 44,
    sample(u, { bounds, elapsed }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = easeInOut(u)
      handheldOffset(elapsed, 0.35, _hand)
      // Parte da arquibancada lateral + um pouco de fundo
      pos.set(
        bounds.minX - lerp(9.5, 7.2, t) * S + _hand.x,
        lerp(11.5, 9.2, t) * HS + _hand.y,
        cz + lerp(bounds.maxZ * 0.62, bounds.maxZ * 0.18, t) + _hand.z,
      )
      look.set(
        cx + lerp(3.5, 1.2, t) * S,
        lerp(0.4, 0.25, t),
        cz + lerp(-3.5, 0.5, t) * S,
      )
    },
  },
  // 3 — Andrada
  {
    duration: 9.5,
    fov: 40,
    sample(u, { bounds, progress }, pos, look) {
      const cz = bounds.center.z
      const t = easeInOut(u)
      const march = Math.max(t, progress * 0.85)
      const along = lerp(bounds.minX - 5.5 * S, bounds.minX + 6.5 * S, march)
      pos.set(
        along - 1.8 * S,
        lerp(1.55, 2.2, t) * HS,
        cz + lerp(-3, 2.5, t) * S,
      )
      look.set(
        along + lerp(3.2, 5.2, t) * S,
        lerp(1.05, 1.2, t),
        cz + lerp(-1, 1, t) * S,
      )
    },
  },
  // 4 — Hino: dolly lento em ~45°, sem pausa por rosto
  {
    duration: ANTHEM_SHOT_DURATION,
    fov: INTRO_FOV_ANTHEM,
    sample(u, { bounds, elapsed }, pos, look) {
      sampleAnthemFaces(u, elapsed, bounds, pos, look)
    },
  },
  // 5 — Meio-campo
  {
    duration: 7.5,
    fov: 44,
    sample(u, { bounds }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = easeInOut(u)
      pos.set(
        bounds.minX - lerp(4.5, 5.8, t) * S,
        lerp(3.8, 5.5, t) * HS,
        cz + lerp(1.5, -1.2, t) * S,
      )
      look.set(cx, lerp(0.7, 0.5, t), cz)
    },
  },
]

const TOTAL_DURATION = INTRO_SHOTS.reduce((sum, s) => sum + s.duration, 0)

const ANTHEM_SHOT_INDEX = 3

const FADE_OUT = 0.48
const FADE_HOLD = 0.16
const FADE_IN = 0.55
const INTRO_OPEN_FADE = 0.7

function shotStartTime(index: number) {
  let t = 0
  for (let i = 0; i < index; i++) t += INTRO_SHOTS[i].duration
  return t
}

export function getIntroAnthemShotStart() {
  return shotStartTime(ANTHEM_SHOT_INDEX)
}

export function getIntroAnthemShotEnd() {
  return getIntroAnthemShotStart() + ANTHEM_SHOT_DURATION
}

export function getIntroSequenceDuration() {
  return TOTAL_DURATION
}

function shotIndexAt(elapsed: number): { index: number; localU: number } {
  const time = THREE.MathUtils.clamp(elapsed, 0, TOTAL_DURATION - 0.001)
  let shotStart = 0

  for (let i = 0; i < INTRO_SHOTS.length; i++) {
    const shotEnd = shotStart + INTRO_SHOTS[i].duration
    const transitionTail = i < INTRO_SHOTS.length - 1 ? FADE_HOLD + FADE_IN : 0

    if (time < shotEnd + transitionTail || i === INTRO_SHOTS.length - 1) {
      if (time < shotEnd) {
        return {
          index: i,
          localU: THREE.MathUtils.clamp((time - shotStart) / INTRO_SHOTS[i].duration, 0, 1),
        }
      }
      if (i < INTRO_SHOTS.length - 1) {
        const tOnNext = Math.max(0, time - shotEnd - FADE_HOLD)
        return {
          index: i + 1,
          localU: THREE.MathUtils.clamp(tOnNext / INTRO_SHOTS[i + 1].duration, 0, 1),
        }
      }
      return {
        index: i,
        localU: THREE.MathUtils.clamp((time - shotStart) / INTRO_SHOTS[i].duration, 0, 1),
      }
    }

    shotStart = shotEnd
  }

  return { index: INTRO_SHOTS.length - 1, localU: 1 }
}

export function getIntroFadeOpacity(elapsed: number): number {
  let opacity = 0

  if (elapsed < INTRO_OPEN_FADE) {
    opacity = Math.max(opacity, 1 - smoothstep(elapsed / INTRO_OPEN_FADE))
  }

  let shotStart = 0
  for (let i = 0; i < INTRO_SHOTS.length - 1; i++) {
    const shotEnd = shotStart + INTRO_SHOTS[i].duration
    const fadeStart = shotEnd - FADE_OUT
    const fadeEnd = shotEnd + FADE_HOLD + FADE_IN

    if (elapsed >= fadeStart && elapsed < fadeEnd) {
      if (elapsed < shotEnd) {
        opacity = Math.max(opacity, smoothstep((elapsed - fadeStart) / FADE_OUT))
      } else if (elapsed < shotEnd + FADE_HOLD) {
        opacity = 1
      } else {
        opacity = Math.max(
          opacity,
          1 - smoothstep((elapsed - shotEnd - FADE_HOLD) / FADE_IN),
        )
      }
    }

    shotStart = shotEnd
  }

  return THREE.MathUtils.clamp(opacity, 0, 1)
}

export function getIntroFov(elapsed: number): number {
  const { index, localU } = shotIndexAt(elapsed)
  if (index === ANTHEM_SHOT_INDEX) {
    const endBlend = smoothstep((localU - 0.72) / 0.28)
    return lerp(INTRO_FOV_ANTHEM, INTRO_FOV_ANTHEM_END, endBlend)
  }
  return INTRO_SHOTS[index]?.fov ?? INTRO_FOV_WIDE
}

export function getIntroCameraState(
  elapsed: number,
  bounds: FieldBounds,
  entranceProgress: number,
  outPos: THREE.Vector3,
  outLook: THREE.Vector3,
) {
  const ctx: IntroCamCtx = { elapsed, progress: entranceProgress, bounds }
  const { index, localU } = shotIndexAt(elapsed)
  INTRO_SHOTS[index].sample(localU, ctx, outPos, outLook)
}

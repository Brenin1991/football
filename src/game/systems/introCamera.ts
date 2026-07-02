import * as THREE from 'three'
import type { FieldBounds } from '../types'
import { FIELD_SCALE } from './fieldData'

const S = FIELD_SCALE
const HS = Math.sqrt(S)

export interface IntroCamCtx {
  elapsed: number
  progress: number
  bounds: FieldBounds
}

type ShotSample = (u: number, ctx: IntroCamCtx, pos: THREE.Vector3, look: THREE.Vector3) => void

interface IntroShot {
  duration: number
  sample: ShotSample
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function smoothstep(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

function ctxOf(bounds: FieldBounds, elapsed: number, progress: number): IntroCamCtx {
  return { elapsed, progress, bounds }
}

/** Sequência da abertura — túnel, hino e dispersão (~52s) */
const INTRO_SHOTS: IntroShot[] = [
  {
    duration: 5.5,
    sample(u, { bounds }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = smoothstep(u)
      pos.set(
        cx + lerp(-14, -10, t) * S,
        lerp(18, 13, t) * HS,
        cz + lerp(bounds.maxZ + 16, bounds.maxZ + 6, t) * S,
      )
      look.set(cx, lerp(0.35, 0.95, t), cz)
    },
  },
  {
    duration: 7.5,
    sample(u, { bounds, progress }, pos, look) {
      const cz = bounds.center.z
      const t = smoothstep(u)
      const march = lerp(bounds.minX - 7 * S, bounds.minX + 2 * S, Math.max(t, progress * 0.55))
      pos.set(
        march,
        lerp(1.4, 2.6, t) * HS,
        cz + lerp(-5.5, 5.5, t) * S,
      )
      look.set(
        bounds.minX + lerp(4, 10, t) * S,
        lerp(0.9, 1.2, t),
        cz + lerp(-2, 2, t) * S,
      )
    },
  },
  {
    duration: 6.5,
    sample(u, { bounds, progress }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = smoothstep(u)
      pos.set(
        bounds.minX - lerp(2.5, 1.2, t) * S,
        lerp(2.8, 4.2, t) * HS,
        cz + lerp(bounds.minZ + 2 * S, bounds.maxZ - 2 * S, Math.max(t * 0.9, progress * 0.4)),
      )
      look.set(
        cx + lerp(-1, 2, t),
        lerp(1.0, 1.25, t),
        cz,
      )
    },
  },
  {
    duration: 9,
    sample(u, { bounds }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = smoothstep(u)
      pos.set(
        bounds.minX - lerp(2.8, 1.4, t) * S,
        lerp(2.4, 3.6, t) * HS,
        cz + lerp(-5, 5, t) * S,
      )
      look.set(
        cx - 3.8 * S,
        lerp(0.95, 1.15, t),
        cz + lerp(-2, 2, t) * S,
      )
    },
  },
  {
    duration: 8,
    sample(u, { bounds }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = smoothstep(u)
      const side = t < 0.5 ? -1 : 1
      const blend = t < 0.5 ? t * 2 : (t - 0.5) * 2
      pos.set(
        cx + lerp(12 * side, 8 * -side, blend) * S,
        lerp(3.6, 5.8, t) * HS,
        cz + lerp(-6 + 12 * t, 6 - 12 * t, t) * S,
      )
      look.set(cx, lerp(0.9, 1.15, t), cz)
    },
  },
  {
    duration: 7,
    sample(u, { bounds, progress }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = smoothstep(u)
      pos.set(
        cx + lerp(-16, -12, t) * S,
        lerp(9, 6.5, t) * HS,
        cz + lerp(-10, progress * 8 - 4, t) * S,
      )
      look.set(cx, lerp(0.75, 1.0, t), cz)
    },
  },
  {
    duration: 8,
    sample(u, { bounds }, pos, look) {
      const cx = bounds.center.x
      const cz = bounds.center.z
      const t = smoothstep(u)
      pos.set(
        cx + lerp(-20, -14, t) * S,
        lerp(12, 8.5, t) * HS,
        cz + lerp(6, -2, t) * S,
      )
      look.set(cx, lerp(0.7, 0.95, t), cz)
    },
  },
]

const TOTAL_DURATION = INTRO_SHOTS.reduce((sum, s) => sum + s.duration, 0)

const FADE_OUT = 0.42
const FADE_HOLD = 0.14
const FADE_IN = 0.52
const INTRO_OPEN_FADE = 0.6

export function getIntroSequenceDuration() {
  return TOTAL_DURATION
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

export function getIntroCameraState(
  elapsed: number,
  bounds: FieldBounds,
  entranceProgress: number,
  outPos: THREE.Vector3,
  outLook: THREE.Vector3,
) {
  const ctx = ctxOf(bounds, elapsed, entranceProgress)
  const time = THREE.MathUtils.clamp(elapsed, 0, TOTAL_DURATION - 0.001)

  let shotStart = 0
  for (let i = 0; i < INTRO_SHOTS.length; i++) {
    const shot = INTRO_SHOTS[i]
    const shotEnd = shotStart + shot.duration
    const transitionTail = i < INTRO_SHOTS.length - 1 ? FADE_HOLD + FADE_IN : 0

    if (time < shotEnd + transitionTail || i === INTRO_SHOTS.length - 1) {
      if (time < shotEnd) {
        const localU = THREE.MathUtils.clamp((time - shotStart) / shot.duration, 0, 1)
        shot.sample(localU, ctx, outPos, outLook)
      } else if (i < INTRO_SHOTS.length - 1) {
        const next = INTRO_SHOTS[i + 1]
        const tOnNext = Math.max(0, time - shotEnd - FADE_HOLD)
        const localU = THREE.MathUtils.clamp(tOnNext / next.duration, 0, 1)
        next.sample(localU, ctx, outPos, outLook)
      } else {
        const localU = THREE.MathUtils.clamp((time - shotStart) / shot.duration, 0, 1)
        shot.sample(localU, ctx, outPos, outLook)
      }
      return
    }

    shotStart = shotEnd
  }
}

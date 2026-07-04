import * as THREE from 'three'
import type { GoalkeeperAnim } from '../types'

const LOCO: GoalkeeperAnim[] = ['gk_idle', 'gk_idle_ball']
const SAVE: GoalkeeperAnim[] = [
  'gk_diving_save_left',
  'gk_diving_save_right',
  'gk_body_save_left',
  'gk_body_save_right',
]
const ONE_SHOT: GoalkeeperAnim[] = [...SAVE, 'gk_hand_pass']

const LOCO_BLEND = 0.28
const SAVE_BLEND = 0.14

type AnimMap = Partial<Record<GoalkeeperAnim, THREE.AnimationAction>>

function isLoco(name: GoalkeeperAnim) {
  return LOCO.includes(name)
}

function isSave(name: GoalkeeperAnim) {
  return SAVE.includes(name)
}

export class GoalkeeperAnimController {
  private current: GoalkeeperAnim = 'gk_idle'
  private action: GoalkeeperAnim | null = null
  private lockUntil = 0
  private finishCleanup: (() => void) | null = null

  constructor(
    private readonly actions: AnimMap,
    private readonly mixer: THREE.AnimationMixer,
  ) {}

  init() {
    for (const [name, action] of Object.entries(this.actions)) {
      if (!action) continue
      const anim = name as GoalkeeperAnim
      if (ONE_SHOT.includes(anim)) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
      }
      action.enabled = true
    }

    const idle = this.actions.gk_idle
    if (!idle) return
    idle.play()
    idle.setEffectiveWeight(1)
    this.fadeOutOthers(idle, undefined, LOCO_BLEND)
    this.current = 'gk_idle'
    this.action = null
  }

  update(delta: number) {
    this.lockUntil = Math.max(0, this.lockUntil - delta)
  }

  isLocked() {
    return this.lockUntil > 0
  }

  isSaving() {
    return this.action != null && isSave(this.action)
  }

  getDisplayAnim(): GoalkeeperAnim {
    if (this.action) return this.action
    return this.current
  }

  isBodyLocked() {
    return this.lockUntil > 0 && this.action != null
  }

  clipSec(name: GoalkeeperAnim) {
    const clip = this.actions[name]?.getClip()
    return clip && clip.duration > 0.01 ? clip.duration : 1
  }

  playbackDurationSec(name: GoalkeeperAnim) {
    return this.clipSec(name)
  }

  private clearListeners() {
    this.finishCleanup?.()
    this.finishCleanup = null
  }

  private fadeOutOthers(
    keepA: THREE.AnimationAction | undefined,
    keepB: THREE.AnimationAction | undefined,
    duration: number,
  ) {
    const keep = new Set<THREE.AnimationAction>()
    if (keepA) keep.add(keepA)
    if (keepB) keep.add(keepB)
    for (const action of Object.values(this.actions)) {
      if (!action || keep.has(action)) continue
      if (action.getEffectiveWeight() > 0.001 || action.isRunning()) {
        action.fadeOut(duration)
      }
    }
  }

  private transition(
    fromName: GoalkeeperAnim,
    toName: GoalkeeperAnim,
    opts?: { duration?: number; warp?: boolean; resetNext?: boolean },
  ) {
    if (fromName === toName) {
      const same = this.actions[toName]
      if (!same) return
      if (!same.isRunning() || same.getEffectiveWeight() < 0.01) {
        same.play()
        same.setEffectiveWeight(1)
      }
      return
    }

    const prev = this.actions[fromName]
    const next = this.actions[toName]
    if (!next) return

    const bothLoco = isLoco(fromName) && isLoco(toName)
    const duration = opts?.duration ?? (bothLoco ? LOCO_BLEND : SAVE_BLEND)
    const warp = opts?.warp ?? bothLoco
    const resetNext = opts?.resetNext ?? !bothLoco

    next.enabled = true
    if (resetNext) next.reset()

    if (prev && prev !== next) {
      prev.enabled = true
      if (!prev.isRunning()) prev.play()
      next.play()
      prev.crossFadeTo(next, duration, warp)
      this.fadeOutOthers(prev, next, duration)
    } else {
      next.play()
      next.setEffectiveWeight(1)
      this.fadeOutOthers(undefined, next, duration)
    }

    this.current = toName
  }

  private returnToIdle(fromName: GoalkeeperAnim, withBall: boolean) {
    const back: GoalkeeperAnim = withBall ? 'gk_idle_ball' : 'gk_idle'
    this.action = null
    this.lockUntil = 0
    this.transition(fromName, back, { warp: true, duration: SAVE_BLEND })
  }

  forceIdle() {
    if (this.action) return
    if (this.current === 'gk_idle') return
    this.transition(this.current, 'gk_idle', { warp: true })
  }

  forceIdleWithBall() {
    if (this.action) return
    if (this.current === 'gk_idle_ball') return
    this.transition(this.current, 'gk_idle_ball', { warp: true })
  }

  playSave(name: GoalkeeperAnim, onFinished?: () => void) {
    const action = this.actions[name]
    if (!action || !isSave(name)) return

    this.clearListeners()
    const duration = this.playbackDurationSec(name)
    this.lockUntil = duration
    this.action = name
    this.transition(this.current, name, { warp: false, duration: SAVE_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== name) return
      this.clearListeners()
      onFinished?.()
      this.returnToIdle(name, false)
    }

    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  playHandPass(onFinished?: () => void) {
    const name: GoalkeeperAnim = 'gk_hand_pass'
    const action = this.actions[name]
    if (!action) {
      onFinished?.()
      return
    }

    this.clearListeners()
    const duration = this.playbackDurationSec(name)
    this.lockUntil = duration
    this.action = name
    this.transition(this.current, name, { warp: false, duration: SAVE_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== name) return
      this.clearListeners()
      onFinished?.()
      this.returnToIdle(name, false)
    }

    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  dispose() {
    this.clearListeners()
  }
}

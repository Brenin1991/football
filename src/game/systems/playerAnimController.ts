import * as THREE from 'three'
import type { PlayerAnim } from '../types'

const LOCO: PlayerAnim[] = ['idle', 'run']
const ONE_SHOT: PlayerAnim[] = ['kick', 'pass', 'shoot']
const ACTION: PlayerAnim[] = ['kick', 'pass', 'shoot', 'carrinho', 'cair']

const LOCO_BLEND = 0.28
const ACTION_BLEND = 0.18
/** Sprint corre um pouco mais rápido que corrida normal */
const SPRINT_TIME_SCALE = 1.12

const STRIKE_CONTACT_RATIO: Partial<Record<PlayerAnim, number>> = {
  pass: 0.52,
  kick: 0.54,
  shoot: 0.46,
}

type AnimMap = Partial<Record<PlayerAnim, THREE.AnimationAction>>

function isLoco(name: PlayerAnim) {
  return LOCO.includes(name)
}

function isOneShot(name: PlayerAnim) {
  return ONE_SHOT.includes(name)
}

function isActionClip(name: PlayerAnim) {
  return ACTION.includes(name)
}

function isMovingStrike(name: PlayerAnim | null) {
  return name === 'pass' || name === 'kick' || name === 'shoot'
}

export class PlayerAnimController {
  /** Clip dominante no mixer (sempre crossfade, nunca stop bruto) */
  private current: PlayerAnim = 'idle'
  /** Ação one-shot / tackle ativa (null = só locomoção) */
  private action: PlayerAnim | null = null
  private locomotionMoving = false
  private runSprint = false
  private lockUntil = 0
  private finishCleanup: (() => void) | null = null
  private contactTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly actions: AnimMap,
    private readonly mixer: THREE.AnimationMixer,
  ) {}

  init() {
    for (const [name, action] of Object.entries(this.actions)) {
      if (!action) continue
      const anim = name as PlayerAnim
      if (isActionClip(anim)) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
      }
      action.enabled = true
    }

    const idle = this.actions.idle
    if (!idle) return
    this.applyScale(idle, 'idle')
    idle.play()
    idle.setEffectiveWeight(1)
    this.fadeOutOthers(idle, undefined, LOCO_BLEND)
    this.current = 'idle'
    this.action = null
  }

  update(delta: number) {
    this.lockUntil = Math.max(0, this.lockUntil - delta)
  }

  isLocked() {
    return this.lockUntil > 0
  }

  isMoving() {
    return this.locomotionMoving
  }

  getAction() {
    return this.action
  }

  getDisplayAnim(): PlayerAnim {
    if (this.action) return this.action
    return this.locomotionMoving ? 'run' : 'idle'
  }

  isSliding() {
    return this.action === 'carrinho'
  }

  isKnockedDown() {
    return this.action === 'cair'
  }

  isBodyLocked() {
    if (isMovingStrike(this.action)) return true
    return (
      this.lockUntil > 0 &&
      this.action != null &&
      (isOneShot(this.action) || this.action === 'cair' || this.action === 'carrinho')
    )
  }

  locksFacing() {
    return isMovingStrike(this.action)
  }

  allowsLocomotionDuringAction() {
    return false
  }

  clipSec(name: PlayerAnim) {
    const clip = this.actions[name]?.getClip()
    return clip && clip.duration > 0.01 ? clip.duration : 1
  }

  playbackDurationSec(name: PlayerAnim) {
    return this.clipSec(name) / this.playbackScale(name)
  }

  private playbackScale(name: PlayerAnim): number {
    if (name === 'run' && this.runSprint) return SPRINT_TIME_SCALE
    return 1
  }

  private clearListeners() {
    this.finishCleanup?.()
    this.finishCleanup = null
    if (this.contactTimer) {
      clearTimeout(this.contactTimer)
      this.contactTimer = null
    }
  }

  private applyScale(action: THREE.AnimationAction, name: PlayerAnim) {
    action.setEffectiveTimeScale(this.playbackScale(name))
  }

  private locoGoal(): 'idle' | 'run' {
    return this.locomotionMoving ? 'run' : 'idle'
  }

  /** Fade suave nos clips que saem — sem stop() (evita T-pose / flick) */
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

  /**
   * Transição conectada — prev crossFadeTo next, resto fadeOut.
   * Igual Unity: sempre blend, nunca corta seco.
   */
  private transition(
    fromName: PlayerAnim,
    toName: PlayerAnim,
    opts?: { duration?: number; warp?: boolean; resetNext?: boolean },
  ) {
    if (fromName === toName) {
      const same = this.actions[toName]
      if (!same) return
      this.applyScale(same, toName)
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
    const duration = opts?.duration ?? (bothLoco ? LOCO_BLEND : ACTION_BLEND)
    const warp = opts?.warp ?? bothLoco
    const resetNext = opts?.resetNext ?? !bothLoco

    next.enabled = true
    if (resetNext) next.reset()
    this.applyScale(next, toName)

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

  private returnToLocomotion(fromName: PlayerAnim) {
    const back = this.locoGoal()
    this.action = null
    this.lockUntil = 0
    this.transition(fromName, back, { warp: true, duration: ACTION_BLEND })
  }

  setLocomotion(moving: boolean, sprint: boolean) {
    this.locomotionMoving = moving
    this.runSprint = sprint

    if (isMovingStrike(this.action)) return
    if (this.action) return

    const target: PlayerAnim = moving ? 'run' : 'idle'
    if (this.current === target) {
      if (target === 'run') this.applyScale(this.actions.run!, 'run')
      return
    }
    this.transition(this.current, target, { warp: true })
  }

  setRunSpeed(sprint: boolean) {
    if (this.action || this.current !== 'run') return
    this.runSprint = sprint
    const run = this.actions.run
    if (run) this.applyScale(run, 'run')
  }

  forceIdle() {
    this.locomotionMoving = false
    if (this.action) return
    if (this.current === 'idle') return
    this.transition(this.current, 'idle', { warp: true })
  }

  forceLocomotion(name: 'idle' | 'run', sprint = false) {
    this.locomotionMoving = name === 'run'
    this.runSprint = sprint
    if (this.action) return
    if (this.current === name) {
      if (name === 'run') this.applyScale(this.actions.run!, 'run')
      return
    }
    this.transition(this.current, name, { warp: true })
  }

  private playAction(
    name: PlayerAnim,
    opts?: { onContact?: () => void; onFinished?: () => void },
  ) {
    const action = this.actions[name]
    if (!action) return

    this.clearListeners()
    const duration = this.playbackDurationSec(name)
    this.lockUntil = duration
    this.action = name

    this.transition(this.current, name, { warp: false, duration: ACTION_BLEND })

    if (opts?.onContact) {
      const ratio = STRIKE_CONTACT_RATIO[name] ?? 0.35
      this.contactTimer = setTimeout(() => {
        this.contactTimer = null
        opts.onContact?.()
      }, duration * ratio * 1000)
    }

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== name) return
      this.clearListeners()
      opts?.onFinished?.()
      this.returnToLocomotion(name)
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  playStrike(name: 'pass' | 'kick' | 'shoot', opts?: { onContact?: () => void }) {
    this.playAction(name, opts)
  }

  playKnockdown() {
    if (this.action === 'cair') return
    const action = this.actions.cair
    if (!action) return

    this.clearListeners()
    this.locomotionMoving = false
    this.lockUntil = this.playbackDurationSec('cair')
    this.action = 'cair'
    this.transition(this.current, 'cair', { warp: false, duration: ACTION_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      this.finishCleanup?.()
      this.finishCleanup = null
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  endKnockdown() {
    if (this.action !== 'cair') return
    this.clearListeners()
    this.returnToLocomotion('cair')
  }

  startSlide() {
    if (this.action === 'carrinho') return
    this.clearListeners()
    this.locomotionMoving = false
    this.lockUntil = this.playbackDurationSec('carrinho')
    this.action = 'carrinho'
    this.transition(this.current, 'carrinho', { warp: false, duration: ACTION_BLEND })
  }

  endSlide() {
    if (this.action !== 'carrinho') return
    this.clearListeners()
    this.returnToLocomotion('carrinho')
  }

  playReplay(anim: PlayerAnim) {
    this.clearListeners()
    this.action = null
    this.lockUntil = 0

    if (anim === 'carrinho') {
      this.startSlide()
      return
    }
    if (anim === 'cair') {
      this.playKnockdown()
      return
    }
    if (isOneShot(anim)) {
      this.playAction(anim as 'pass' | 'kick' | 'shoot')
      return
    }
    this.locomotionMoving = anim === 'run'
    this.transition(this.current, anim, { warp: true })
  }

  dispose() {
    this.clearListeners()
  }
}

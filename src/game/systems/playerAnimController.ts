import * as THREE from 'three'
import type { PlayerAnim, PlayerLocoAnim, PlayerStrikeAnim } from '../types'
import { resolveStrafeLocoClip, resolveDirectLocoClip } from './playerLocomotion'
import { resolveCarrierLocoClip } from './playerDribbleControl'
import {
  PLAYER_ACTION_ANIMS,
  PLAYER_LOCO_ANIMS,
  PLAYER_STRIKE_ANIMS,
} from './playerClipRegistry'

const LOCO_BLEND = 0.22
const ACTION_BLEND = 0.16
const SPRINT_TIME_SCALE = 1.14
const RECEIVE_TIME_SCALE = 1.18
const HEADER_TIME_SCALE = 1.08
const WALK_TIME_SCALE = 1
const WALK_FALLBACK_TIME_SCALE = 0.65
const BACKWARD_TIME_SCALE = 0.68
const SIDE_STRAFE_TIME_SCALE = 0.88

const STRIKE_TIME_SCALE: Partial<Record<PlayerStrikeAnim, number>> = {
  player_pass: 1.42,
  player_kick: 1.28,
  player_shoot: 1.32,
}

const STRIKE_MOVE_MUL: Partial<Record<PlayerStrikeAnim, number>> = {
  player_pass: 0.86,
  player_kick: 0.68,
  player_shoot: 0.65,
}

const THROW_IN_TIME_SCALE = 1.12
const THROW_IN_CONTACT_RATIO = 0.56
const SPIN_TIME_SCALE = 1.14
/** Novas ações um pouco mais rápidas para não travarem o ritmo do jogo. */
const FINTA_TIME_SCALE = 1.2
const IMBALANCE_TIME_SCALE = 1.15
const SHOULDER_CHARGE_TIME_SCALE = 1.18
const RUN_STOP_TIME_SCALE = 1.2

const STRIKE_CONTACT_RATIO: Partial<Record<PlayerStrikeAnim, number>> = {
  player_pass: 0.24,
  player_kick: 0.26,
  player_shoot: 0.22,
}

type AnimMap = Partial<Record<PlayerAnim, THREE.AnimationAction>>

function isLoco(name: PlayerAnim): name is PlayerLocoAnim {
  return PLAYER_LOCO_ANIMS.includes(name as PlayerLocoAnim)
}

function isStrike(name: PlayerAnim | null): name is PlayerStrikeAnim {
  return name != null && PLAYER_STRIKE_ANIMS.includes(name as PlayerStrikeAnim)
}

function isActionClip(name: PlayerAnim) {
  return PLAYER_ACTION_ANIMS.includes(name)
}

export type StrafeLocoInput = {
  moving: boolean
  sprint: boolean
  localForward: number
  localRight: number
}

export class PlayerAnimController {
  private current: PlayerLocoAnim = 'player_idle'
  private action: PlayerAnim | null = null
  private lockUntil = 0
  private finishCleanup: (() => void) | null = null
  private contactTimer: ReturnType<typeof setTimeout> | null = null
  private strafeSprint = false
  private dribbleTouchUntil = 0
  private dribbleTouchAnim: PlayerLocoAnim | null = null
  private rootMotionSnapshot: (() => void) | null = null
  private rootMotionSnapshotFired = false
  private holdBallAction: THREE.AnimationAction | null = null
  private holdBallActive = false
  /** Idle parado no campo (espera passe / formação) — sempre player_idle */
  private fieldIdleActive = false

  constructor(
    private readonly actions: AnimMap,
    private readonly mixer: THREE.AnimationMixer,
  ) {}

  init() {
    for (const [name, action] of Object.entries(this.actions)) {
      if (!action) continue
      const anim = name as PlayerAnim
      if (anim === 'player_shoulder_charge') {
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
      } else if (isActionClip(anim)) {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = false
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
      }
      action.enabled = true
    }

    const idle = this.actions.player_idle
    if (!idle) return
    this.applyScale(idle, 'player_idle')
    idle.play()
    idle.setEffectiveWeight(1)
    this.fadeOutOthers(idle, undefined, LOCO_BLEND)
    this.current = 'player_idle'
    this.action = null
  }

  update(delta: number) {
    this.lockUntil = Math.max(0, this.lockUntil - delta)
    this.dribbleTouchUntil = Math.max(0, this.dribbleTouchUntil - delta)
    if (this.dribbleTouchUntil <= 0) this.dribbleTouchAnim = null
  }

  isDribbleTouching() {
    return this.dribbleTouchUntil > 0
  }

  isLocked() {
    return this.lockUntil > 0
  }

  getAction() {
    return this.action
  }

  getDisplayAnim(): PlayerAnim {
    if (this.action) return this.action
    if (this.holdBallActive) return 'player_idle'
    if (this.fieldIdleActive) return 'player_idle'
    return this.current
  }

  getAnimTime(): number {
    if (this.holdBallActive && this.holdBallAction) {
      return this.holdBallAction.time
    }
    const name = this.getDisplayAnim()
    return this.actions[name]?.time ?? 0
  }

  isThrowInHolding() {
    return this.holdBallActive
  }

  bindHoldBallIdle(action?: THREE.AnimationAction) {
    this.holdBallAction = action ?? null
    if (!action) return
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.enabled = true
  }

  /** @deprecated Idle de campo usa player_idle; mantido só por compat. */
  bindFieldIdle(_action?: THREE.AnimationAction) {}

  /** Parado no campo (espera passe / hold de formação). Sem clip extra — evita T-pose. */
  enterFieldIdle() {
    if (this.action || this.holdBallActive) return
    this.ensurePlayerIdle(LOCO_BLEND)
    this.fieldIdleActive = true
  }

  exitFieldIdle() {
    this.fieldIdleActive = false
  }

  isFieldIdle() {
    return this.fieldIdleActive
  }

  /** Garante player_idle rodando com peso 1 (nunca deixa mixer vazio → T-pose). */
  private ensurePlayerIdle(blend = LOCO_BLEND) {
    const idle = this.actions.player_idle
    if (!idle) return
    const needRestart =
      this.current !== 'player_idle' ||
      !idle.isRunning() ||
      idle.getEffectiveWeight() < 0.05
    this.current = 'player_idle'
    idle.enabled = true
    this.applyScale(idle, 'player_idle')
    if (needRestart) {
      if (!idle.isRunning()) {
        idle.reset()
        idle.play()
      }
      idle.setEffectiveWeight(1)
      this.fadeOutOthers(idle, undefined, blend)
    } else {
      idle.setEffectiveWeight(1)
    }
  }

  enterThrowInHold() {
    if (this.action || !this.holdBallAction) return
    this.exitFieldIdle()
    const hold = this.holdBallAction
    if (this.holdBallActive) {
      if (!hold.isRunning() || hold.getEffectiveWeight() < 0.01) {
        hold.play()
        hold.setEffectiveWeight(1)
      }
      return
    }

    this.holdBallActive = true
    const prev = this.actions[this.current]
    hold.enabled = true
    hold.reset()
    hold.play()
    hold.setEffectiveWeight(1)
    if (prev && prev !== hold) prev.fadeOut(LOCO_BLEND)
    this.fadeOutOthers(hold, undefined, LOCO_BLEND)
  }

  exitThrowInHold() {
    if (!this.holdBallActive) return
    this.holdBallActive = false
    this.holdBallAction?.fadeOut(LOCO_BLEND)
  }

  playThrowIn(opts?: { onContact?: () => void }) {
    this.exitThrowInHold()
    this.playAction('player_throw_in', opts)
  }

  playSpin(onFinished?: () => void) {
    if (this.action || this.holdBallActive) return
    const action = this.actions.player_spin
    if (!action) return

    this.clearListeners()
    this.beginRootMotionAction()
    this.lockUntil = this.playbackDurationSec('player_spin')
    this.action = 'player_spin'
    this.transition(this.current, 'player_spin', { warp: false, duration: ACTION_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== 'player_spin') return
      this.clearListeners()
      this.fireRootMotionSnapshot()
      onFinished?.()
      this.releaseToLocomotion('player_spin')
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  endSpin() {
    if (this.action !== 'player_spin') return
    this.clearListeners()
    this.fireRootMotionSnapshot()
    this.returnToLocomotion('player_spin')
  }

  isSpinning() {
    return this.action === 'player_spin'
  }

  isSliding() {
    return this.action === 'player_tackle'
  }

  isKnockedDown() {
    return this.action === 'player_trip'
  }

  isFinting() {
    return this.action === 'player_finta_01' || this.action === 'player_finta_180'
  }

  isImbalancing() {
    return (
      this.action === 'player_imbalance_01' ||
      this.action === 'player_imbalance_stolen'
    )
  }

  isShoulderCharging() {
    return this.action === 'player_shoulder_charge'
  }

  isRunStopping() {
    return this.action === 'player_run_stop'
  }

  /** Animações com deslocamento de esqueleto — corpo segue o último frame. */
  absorbsRootMotion() {
    return (
      this.action === 'player_tackle' ||
      this.action === 'player_trip' ||
      this.action === 'player_spin' ||
      this.action === 'player_finta_01' ||
      this.action === 'player_finta_180' ||
      this.action === 'player_imbalance_01' ||
      this.action === 'player_imbalance_stolen'
    )
  }

  setRootMotionSnapshot(fn: (() => void) | null) {
    this.rootMotionSnapshot = fn
  }

  private fireRootMotionSnapshot() {
    if (this.rootMotionSnapshotFired || !this.rootMotionSnapshot) return
    this.rootMotionSnapshotFired = true
    this.rootMotionSnapshot()
  }

  private beginRootMotionAction() {
    this.rootMotionSnapshotFired = false
  }

  isReceiving() {
    return this.action === 'player_receive'
  }

  isHeading() {
    return this.action === 'player_header'
  }

  isBodyLocked() {
    if (isStrike(this.action)) return false
    if (this.action === 'player_receive' || this.action === 'player_header') return false
    // Ombro em loop — ainda anda no bote; run_stop só planta a parada
    if (this.action === 'player_shoulder_charge') return false
    return (
      this.lockUntil > 0 &&
      this.action != null &&
      isActionClip(this.action)
    )
  }

  isStriking() {
    return isStrike(this.action)
  }

  locksFacing() {
    return this.action === 'player_receive' || this.action === 'player_header'
  }

  allowsLocomotionDuringAction() {
    return isStrike(this.action) || this.action === 'player_shoulder_charge'
  }

  getStrikeMoveMultiplier() {
    if (!isStrike(this.action)) return 1
    return STRIKE_MOVE_MUL[this.action] ?? 1
  }

  clipSec(name: PlayerAnim) {
    const clip = this.actions[name]?.getClip()
    return clip && clip.duration > 0.01 ? clip.duration : 1
  }

  playbackDurationSec(name: PlayerAnim) {
    return this.clipSec(name) / this.playbackScale(name)
  }

  private playbackScale(name: PlayerAnim): number {
    if (name === 'player_run' && this.strafeSprint) return SPRINT_TIME_SCALE
    if (name === 'player_receive') return RECEIVE_TIME_SCALE
    if (name === 'player_header') return HEADER_TIME_SCALE
    if (name === 'player_backward') return BACKWARD_TIME_SCALE
    if (name === 'player_left' || name === 'player_right') return SIDE_STRAFE_TIME_SCALE
    if (name === 'player_walking') {
      const clipName = this.actions.player_walking?.getClip()?.name
      return clipName === 'player_walking' ? WALK_TIME_SCALE : WALK_FALLBACK_TIME_SCALE
    }
    if (isStrike(name as PlayerAnim)) return STRIKE_TIME_SCALE[name as PlayerStrikeAnim] ?? 1
    if (name === 'player_throw_in') return THROW_IN_TIME_SCALE
    if (name === 'player_spin') return SPIN_TIME_SCALE
    if (name === 'player_finta_01' || name === 'player_finta_180') {
      return FINTA_TIME_SCALE
    }
    if (name === 'player_imbalance_01' || name === 'player_imbalance_stolen') {
      return IMBALANCE_TIME_SCALE
    }
    if (name === 'player_shoulder_charge') return SHOULDER_CHARGE_TIME_SCALE
    if (name === 'player_run_stop') return RUN_STOP_TIME_SCALE
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

    if (isLoco(toName)) this.current = toName
  }

  private releaseToLocomotion(fromName: PlayerAnim, toLoco: PlayerLocoAnim = 'player_idle') {
    const finished = this.actions[fromName]
    finished?.stop()
    finished?.reset()

    this.action = null
    this.lockUntil = 0

    const idle = this.actions[toLoco]
    if (!idle) return

    idle.enabled = true
    idle.reset()
    idle.play()
    this.applyScale(idle, toLoco)
    idle.setEffectiveWeight(1)
    this.fadeOutOthers(idle, undefined, ACTION_BLEND)
    this.current = toLoco
  }

  private returnToLocomotion(fromName: PlayerAnim) {
    this.releaseToLocomotion(fromName, 'player_idle')
  }

  setStrafeLocomotion(input: StrafeLocoInput) {
    if (this.holdBallActive) return
    if (this.fieldIdleActive && !input.moving) return
    if (isStrike(this.action)) return
    if (this.action && this.action !== 'player_receive' && this.action !== 'player_header') return
    if (this.dribbleTouchUntil > 0) return

    if (input.moving) this.exitFieldIdle()
    else if (this.tryPlayRunStopBeforeIdle()) return

    this.strafeSprint = input.sprint

    const target = input.moving
      ? resolveStrafeLocoClip(input.localForward, input.localRight, input.sprint)
      : 'player_idle'

    if (this.current === target) {
      const action = this.actions[target]
      if (!action) return
      this.applyScale(action, target)
      if (!action.isRunning() || action.getEffectiveWeight() < 0.01) {
        action.enabled = true
        action.reset()
        action.play()
        action.setEffectiveWeight(1)
        this.fadeOutOthers(action, undefined, LOCO_BLEND)
      }
      return
    }
    this.transition(this.current, target, { warp: true })
  }

  setDirectLocomotion(input: { moving: boolean; sprint: boolean }) {
    if (this.holdBallActive) return
    if (this.fieldIdleActive && !input.moving) return
    if (isStrike(this.action)) return
    if (this.action && this.action !== 'player_receive' && this.action !== 'player_header') return
    if (this.dribbleTouchUntil > 0) return

    if (input.moving) this.exitFieldIdle()
    else if (this.tryPlayRunStopBeforeIdle()) return

    this.strafeSprint = input.sprint

    const target = resolveDirectLocoClip(input.moving, input.sprint)

    if (this.current === target) {
      const action = this.actions[target]
      if (!action) return
      this.applyScale(action, target)
      if (!action.isRunning() || action.getEffectiveWeight() < 0.01) {
        action.enabled = true
        action.reset()
        action.play()
        action.setEffectiveWeight(1)
        this.fadeOutOthers(action, undefined, LOCO_BLEND)
      }
      return
    }
    this.transition(this.current, target, { warp: true })
  }

  setCarrierLocomotion(input: StrafeLocoInput) {
    if (this.holdBallActive) return
    if (this.fieldIdleActive && !input.moving) return
    if (isStrike(this.action)) return
    if (this.action && this.action !== 'player_receive' && this.action !== 'player_header') return
    if (this.dribbleTouchUntil > 0) return

    if (input.moving) this.exitFieldIdle()
    else if (this.tryPlayRunStopBeforeIdle()) return

    this.strafeSprint = input.sprint

    const target = input.moving
      ? resolveCarrierLocoClip(input.localForward, input.localRight, input.sprint)
      : 'player_idle'

    if (this.current === target) {
      const action = this.actions[target]
      if (!action) return
      this.applyScale(action, target)
      if (!action.isRunning() || action.getEffectiveWeight() < 0.01) {
        action.enabled = true
        action.reset()
        action.play()
        action.setEffectiveWeight(1)
        this.fadeOutOthers(action, undefined, LOCO_BLEND)
      }
      return
    }
    this.transition(this.current, target, { warp: true })
  }

  /** Se estava andando/correndo, toca run_stop em vez de ir direto pro idle. */
  private tryPlayRunStopBeforeIdle(): boolean {
    if (this.isRunStopping()) return true
    if (this.current === 'player_idle') return false
    if (!this.actions.player_run_stop) return false
    this.playRunStop()
    return this.isRunStopping()
  }

  playDribbleTouch(
    anim: 'player_left' | 'player_right' | 'player_backward',
    duration: number,
  ) {
    if (isStrike(this.action)) return
    if (
      this.action &&
      this.action !== 'player_receive' &&
      this.action !== 'player_header'
    ) {
      return
    }

    this.exitFieldIdle()

    if (this.dribbleTouchAnim === anim && this.dribbleTouchUntil > 0) {
      this.dribbleTouchUntil = Math.max(this.dribbleTouchUntil, duration)
      return
    }

    this.dribbleTouchAnim = anim
    this.dribbleTouchUntil = duration
    this.transition(this.current, anim, { warp: true, duration: 0.2 })
  }

  forceIdle() {
    if (this.action) return
    if (this.holdBallActive) return
    this.exitFieldIdle()
    this.ensurePlayerIdle(LOCO_BLEND)
  }

  private playAction(
    name: PlayerAnim,
    opts?: { onContact?: () => void; onFinished?: () => void },
  ) {
    const action = this.actions[name]
    if (!action) {
      opts?.onContact?.()
      opts?.onFinished?.()
      return
    }

    this.exitFieldIdle()
    this.clearListeners()
    const duration = this.playbackDurationSec(name)
    this.lockUntil = duration
    this.action = name

    this.transition(this.current, name, { warp: false, duration: ACTION_BLEND })

    if (opts?.onContact) {
      const ratio =
        name === 'player_throw_in'
          ? THROW_IN_CONTACT_RATIO
          : isStrike(name)
            ? (STRIKE_CONTACT_RATIO[name] ?? 0.35)
            : 0.38
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

  playStrike(
    name: PlayerStrikeAnim,
    opts?: { onContact?: () => void; instantContact?: boolean },
  ) {
    if (opts?.instantContact && opts.onContact) {
      opts.onContact()
      this.playAction(name)
      return
    }
    this.playAction(name, opts)
  }

  playReceive(opts?: { onContact?: () => void; onFinished?: () => void }) {
    this.playAction('player_receive', opts)
  }

  playHeader(opts?: { onContact?: () => void; onFinished?: () => void }) {
    this.playAction('player_header', opts)
  }

  playKnockdown() {
    if (this.action === 'player_trip') return
    const action = this.actions.player_trip
    if (!action) return

    this.clearListeners()
    this.beginRootMotionAction()
    this.lockUntil = this.playbackDurationSec('player_trip')
    this.action = 'player_trip'
    this.transition(this.current, 'player_trip', { warp: false, duration: ACTION_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      this.clearListeners()
      this.fireRootMotionSnapshot()
      this.releaseToLocomotion('player_trip')
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  endKnockdown() {
    if (this.action !== 'player_trip') return
    this.clearListeners()
    this.fireRootMotionSnapshot()
    this.returnToLocomotion('player_trip')
  }

  startSlide() {
    if (this.action === 'player_tackle') return
    const action = this.actions.player_tackle
    if (!action) return

    this.clearListeners()
    this.beginRootMotionAction()
    this.lockUntil = this.playbackDurationSec('player_tackle')
    this.action = 'player_tackle'
    this.transition(this.current, 'player_tackle', { warp: false, duration: ACTION_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== 'player_tackle') return
      this.clearListeners()
      this.fireRootMotionSnapshot()
      this.returnToLocomotion('player_tackle')
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  endSlide() {
    if (this.action !== 'player_tackle') return
    this.clearListeners()
    this.fireRootMotionSnapshot()
    this.returnToLocomotion('player_tackle')
  }

  /** Finta de chute → vira pro lado (root motion, igual carrinho). */
  playFinta01(onFinished?: () => void) {
    this.playRootMotionOnce('player_finta_01', onFinished)
  }

  /** Corte 180° em corrida (root motion). */
  playFinta180(onFinished?: () => void) {
    this.playRootMotionOnce('player_finta_180', onFinished)
  }

  /** Choque corpo a corpo na roubada — desequilíbrio (root motion). */
  playImbalance(onFinished?: () => void) {
    this.playRootMotionOnce('player_imbalance_01', onFinished)
  }

  /** Bola roubada — desequilíbrio (root motion). */
  playImbalanceStolen(onFinished?: () => void) {
    this.playRootMotionOnce('player_imbalance_stolen', onFinished)
  }

  /** Roubador no contato — loop até endShoulderCharge. */
  playShoulderCharge() {
    if (this.action === 'player_shoulder_charge') return
    if (
      this.action === 'player_tackle' ||
      this.action === 'player_trip' ||
      this.action === 'player_finta_01' ||
      this.action === 'player_finta_180' ||
      this.action === 'player_imbalance_01' ||
      this.action === 'player_imbalance_stolen'
    ) {
      return
    }
    const action = this.actions.player_shoulder_charge
    if (!action) return

    this.clearListeners()
    this.lockUntil = 0
    this.action = 'player_shoulder_charge'
    action.setLoop(THREE.LoopRepeat, Infinity)
    this.transition(this.current, 'player_shoulder_charge', {
      warp: false,
      duration: ACTION_BLEND,
    })
  }

  endShoulderCharge() {
    if (this.action !== 'player_shoulder_charge') return
    this.clearListeners()
    this.returnToLocomotion('player_shoulder_charge')
  }

  /** Freada após corrida. */
  playRunStop(onFinished?: () => void) {
    if (this.action === 'player_run_stop') return
    if (this.holdBallActive) return
    if (
      this.action === 'player_tackle' ||
      this.action === 'player_trip' ||
      this.action === 'player_spin' ||
      this.action === 'player_finta_01' ||
      this.action === 'player_finta_180' ||
      this.action === 'player_imbalance_01' ||
      this.action === 'player_imbalance_stolen'
    ) {
      return
    }
    const action = this.actions.player_run_stop
    if (!action) return

    // Interrompe ombro se estiver no loop
    if (this.action === 'player_shoulder_charge') {
      this.clearListeners()
      this.action = null
      this.lockUntil = 0
    }

    this.clearListeners()
    this.lockUntil = this.playbackDurationSec('player_run_stop')
    this.action = 'player_run_stop'
    this.transition(this.current, 'player_run_stop', {
      warp: false,
      duration: ACTION_BLEND * 0.7,
    })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== 'player_run_stop') return
      this.clearListeners()
      onFinished?.()
      this.releaseToLocomotion('player_run_stop')
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  private playRootMotionOnce(
    name:
      | 'player_finta_01'
      | 'player_finta_180'
      | 'player_imbalance_01'
      | 'player_imbalance_stolen',
    onFinished?: () => void,
  ) {
    if (this.action === name) return
    if (
      this.action === 'player_tackle' ||
      this.action === 'player_trip' ||
      this.action === 'player_spin' ||
      this.action === 'player_finta_01' ||
      this.action === 'player_finta_180' ||
      this.action === 'player_imbalance_01' ||
      this.action === 'player_imbalance_stolen'
    ) {
      return
    }
    if (this.action === 'player_shoulder_charge' || this.action === 'player_run_stop') {
      this.clearListeners()
      const prev = this.actions[this.action]
      prev?.fadeOut(ACTION_BLEND)
      this.action = null
      this.lockUntil = 0
    }
    const action = this.actions[name]
    if (!action) return

    this.clearListeners()
    this.beginRootMotionAction()
    this.lockUntil = this.playbackDurationSec(name)
    this.action = name
    this.transition(this.current, name, { warp: false, duration: ACTION_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== name) return
      this.clearListeners()
      this.fireRootMotionSnapshot()
      onFinished?.()
      this.releaseToLocomotion(name)
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  dispose() {
    this.clearListeners()
    this.exitThrowInHold()
  }
}

export function legacyLocoFromMoving(moving: boolean, sprint: boolean): PlayerLocoAnim {
  if (!moving) return 'player_idle'
  return sprint ? 'player_run' : 'player_walking'
}

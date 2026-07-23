import * as THREE from 'three'
import type { PlayerAnim, PlayerLocoAnim, PlayerStrikeAnim } from '../types'
import { resolveStrafeLocoClip, resolveDirectLocoClip } from './playerLocomotion'
import { resolveCarrierLocoClip } from './playerDribbleControl'
import {
  isStandingIdleAnim,
  isShotStrikeAnim,
  PLAYER_ACTION_ANIMS,
  PLAYER_CELEBRATION_ANIMS,
  PLAYER_IDLE_VARIANT_ANIMS,
  PLAYER_LOCO_ANIMS,
  PLAYER_STRIKE_ANIMS,
} from './playerClipRegistry'
import { SHOT_CONTACT_MIN_DELAY_SEC, SHOT_CONTACT_RATIO, SHOT_FIRST_TIME_CONTACT_MIN_DELAY_SEC, SHOT_FIRST_TIME_CONTACT_RATIO, SHOT_FIRST_TIME_TIME_SCALE_MUL } from './shotPower'

const LOCO_BLEND = 0.22
const ACTION_BLEND = 0.16
const SPRINT_TIME_SCALE = 1.14
const RECEIVE_TIME_SCALE = 1.18
const HEADER_TIME_SCALE = 1.08
const WALK_TIME_SCALE = 1.5
const WALK_FALLBACK_TIME_SCALE = 0.65
const BACKWARD_TIME_SCALE = 1.68
const SIDE_STRAFE_TIME_SCALE = 1.88

const STRIKE_TIME_SCALE: Partial<Record<PlayerStrikeAnim, number>> = {
  player_pass: 1.42,
  player_pass_short: 1.48,
  player_pass_long: 1.62,
  player_kick: 1.28,
  player_kick_low: 1.38,
  player_kick_medium: 1.32,
  player_kick_high: 1.22,
  player_shoot: 1.32,
}

const STRIKE_MOVE_MUL: Partial<Record<PlayerStrikeAnim, number>> = {
  player_pass: 0.9,
  player_pass_short: 0.7,
  player_pass_long: 0.9,
  player_kick: 0.9,
  player_kick_low: 0.9,
  player_kick_medium: 0.7,
  player_kick_high: 0.8,
  player_shoot: 0.9,
}

const THROW_IN_TIME_SCALE = 1.12
const THROW_IN_CONTACT_RATIO = 0.56
const SPIN_TIME_SCALE = 1.5
/** Novas ações um pouco mais rápidas para não travarem o ritmo do jogo. */
const FINTA_TIME_SCALE = 1.4
const IMBALANCE_TIME_SCALE = 1.15
const SHOULDER_CHARGE_TIME_SCALE = 1.18
const RUN_STOP_TIME_SCALE = 1.2

const STRIKE_CONTACT_RATIO: Partial<Record<PlayerStrikeAnim, number>> = {
  player_pass: 0.24,
  player_pass_short: 0.22,
  player_pass_long: 0.26,
  player_kick: 0.26,
  player_kick_low: 0.22,
  player_kick_medium: SHOT_CONTACT_RATIO,
  player_kick_high: 0.3,
  player_shoot: SHOT_CONTACT_RATIO,
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
  /** Sprint estável pra clip — evita run↔walk tremendo */
  private locoSprintStable = false
  private locoSprintPending: boolean | null = null
  private locoSprintPendingSince = 0
  private lastLocoSwitchAt = 0
  private dribbleTouchUntil = 0
  private dribbleTouchAnim: PlayerLocoAnim | null = null
  private rootMotionSnapshot: (() => void) | null = null
  private rootMotionSnapshotFired = false
  private holdBallAction: THREE.AnimationAction | null = null
  private holdBallActive = false
  /** Idle parado no campo (espera passe / formação) */
  private fieldIdleActive = false
  /** Pool de idles disponíveis no GLB (idle_01..05 ou player_idle) */
  private idlePool: PlayerLocoAnim[] = ['player_idle']
  private idleSequenceActive = false
  private idleFinishCleanup: (() => void) | null = null
  private lastIdlePick: PlayerLocoAnim | null = null
  /** Modelo do jogador — scale.x negativo = mirror (pé esquerdo). */
  private modelRoot: THREE.Object3D | null = null
  private strikeMirrored = false

  constructor(
    private readonly actions: AnimMap,
    private readonly mixer: THREE.AnimationMixer,
  ) {}

  bindModelRoot(root: THREE.Object3D | null) {
    this.modelRoot = root
  }

  init() {
    this.rebuildIdlePool()

    for (const [name, action] of Object.entries(this.actions)) {
      if (!action) continue
      const anim = name as PlayerAnim
      if (anim === 'player_shoulder_charge') {
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = false
      } else if (isStandingIdleAnim(anim)) {
        // Idles em sequência (LoopOnce → próximo aleatório)
        action.setLoop(THREE.LoopOnce, 1)
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

    this.action = null
    this.startIdleSequence(LOCO_BLEND)
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
    return this.current
  }

  getAnimTime(): number {
    if (this.holdBallActive && this.holdBallAction) {
      return this.holdBallAction.time
    }
    const name = this.getDisplayAnim()
    return this.actions[name]?.time ?? 0
  }

  /** 0..1 — progresso da clip de ação atual (spin, finta, etc). */
  getActionProgress(): number {
    if (!this.action) return 0
    const action = this.actions[this.action]
    const clip = action?.getClip()
    if (!action || !clip || clip.duration < 0.01) return 0
    return THREE.MathUtils.clamp(action.time / clip.duration, 0, 1)
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

  /** Parado no campo (espera passe / hold de formação). */
  enterFieldIdle() {
    if (this.action || this.holdBallActive) return
    this.startIdleSequence(LOCO_BLEND)
    this.fieldIdleActive = true
  }

  exitFieldIdle() {
    this.fieldIdleActive = false
  }

  isFieldIdle() {
    return this.fieldIdleActive
  }

  private rebuildIdlePool() {
    const variants = PLAYER_IDLE_VARIANT_ANIMS.filter(
      (name) => this.actions[name],
    ) as PlayerLocoAnim[]
    if (variants.length > 0) {
      this.idlePool = variants
      return
    }
    this.idlePool = this.actions.player_idle ? ['player_idle'] : []
  }

  private pickNextIdle(): PlayerLocoAnim | null {
    if (this.idlePool.length === 0) return null
    if (this.idlePool.length === 1) return this.idlePool[0]!
    let pick = this.idlePool[Math.floor(Math.random() * this.idlePool.length)]!
    let guard = 0
    while (pick === this.lastIdlePick && guard++ < 8) {
      pick = this.idlePool[Math.floor(Math.random() * this.idlePool.length)]!
    }
    return pick
  }

  private stopIdleSequence() {
    this.idleSequenceActive = false
    if (this.idleFinishCleanup) {
      this.idleFinishCleanup()
      this.idleFinishCleanup = null
    }
  }

  /** Encadeia idle_01..05 (ou player_idle) em ordem aleatória enquanto parado. */
  private startIdleSequence(blend = LOCO_BLEND) {
    if (this.action || this.holdBallActive) return
    if (this.idlePool.length === 0) this.rebuildIdlePool()
    if (this.idlePool.length === 0) return

    if (
      this.idleSequenceActive &&
      isStandingIdleAnim(this.current)
    ) {
      const cur = this.actions[this.current]
      if (cur && cur.isRunning() && cur.getEffectiveWeight() > 0.05) return
    }

    this.playNextIdleClip(blend)
  }

  private playNextIdleClip(blend = LOCO_BLEND) {
    if (this.action || this.holdBallActive) {
      this.stopIdleSequence()
      return
    }
    const pick = this.pickNextIdle()
    if (!pick) return
    const next = this.actions[pick]
    if (!next) return

    if (this.idleFinishCleanup) {
      this.idleFinishCleanup()
      this.idleFinishCleanup = null
    }

    this.idleSequenceActive = true
    this.lastIdlePick = pick
    this.transition(this.current, pick, {
      warp: false,
      duration: blend,
      resetNext: true,
    })
    this.current = pick

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== next) return
      if (!this.idleSequenceActive) return
      if (this.current !== pick) return
      if (this.action || this.holdBallActive) return
      if (this.idleFinishCleanup) {
        this.idleFinishCleanup()
        this.idleFinishCleanup = null
      }
      this.playNextIdleClip(LOCO_BLEND * 0.9)
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.idleFinishCleanup = () =>
      this.mixer.removeEventListener('finished', handleFinished)
  }

  /** Garante idle rodando (pool aleatório) — nunca deixa mixer vazio → T-pose. */
  private ensurePlayerIdle(blend = LOCO_BLEND) {
    this.startIdleSequence(blend)
  }

  enterThrowInHold() {
    if (this.action || !this.holdBallAction) return
    this.exitFieldIdle()
    this.stopIdleSequence()
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

    this.clearStrikeMirror()
    this.stopIdleSequence()
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
      // player_spin NÃO entra: pinamos o quadril pra bola não ficar pra trás no 360
      this.action === 'player_finta_01' ||
      this.action === 'player_finta_180' ||
      this.action === 'player_imbalance_01' ||
      this.action === 'player_imbalance_stolen' ||
      (this.action?.startsWith('celebration_') ?? false)
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
    this.stopIdleSequence()
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
    // 360: gira no lugar com a bola colada, ainda pode carregar o drible
    if (this.action === 'player_spin') return false
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
    return (
      isStrike(this.action) ||
      this.action === 'player_shoulder_charge' ||
      this.action === 'player_spin'
    )
  }

  getStrikeMoveMultiplier() {
    if (!isStrike(this.action)) return 1
    return STRIKE_MOVE_MUL[this.action] ?? 1
  }

  /** Roulette: leve freio — bola já cola firme no stepPossessedBall. */
  getSpinMoveMultiplier() {
    return this.action === 'player_spin' ? 0.92 : 1
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

  private releaseToLocomotion(fromName: PlayerAnim, _toLoco: PlayerLocoAnim = 'player_idle') {
    const finished = this.actions[fromName]
    finished?.stop()
    finished?.reset()

    this.clearStrikeMirror()
    this.action = null
    this.lockUntil = 0
    this.startIdleSequence(ACTION_BLEND)
  }

  private applyStrikeMirror(mirrored: boolean) {
    const root = this.modelRoot
    if (!root) {
      this.strikeMirrored = false
      return
    }
    const base = Math.abs(root.scale.x) || 1
    root.scale.x = mirrored ? -base : base
    this.strikeMirrored = mirrored
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        if (!mat) continue
        if (mat.userData._strikeSide == null) mat.userData._strikeSide = mat.side
        mat.side = mirrored ? THREE.DoubleSide : mat.userData._strikeSide
        mat.needsUpdate = true
      }
    })
  }

  private clearStrikeMirror() {
    if (!this.strikeMirrored && !(this.modelRoot && this.modelRoot.scale.x < 0)) return
    this.applyStrikeMirror(false)
  }

  /**
   * Histerese no sprint da animação.
   * Stamina/pressão flippam o flag → sem isso a clip run/walk treme.
   */
  private stabilizeLocoSprint(wantSprint: boolean): boolean {
    const now = performance.now()
    if (wantSprint === this.locoSprintStable) {
      this.locoSprintPending = null
      return this.locoSprintStable
    }
    if (this.locoSprintPending !== wantSprint) {
      this.locoSprintPending = wantSprint
      this.locoSprintPendingSince = now
      return this.locoSprintStable
    }
    // Ligar run: 200ms firme. Voltar pra walk: 320ms (cansado não flicker)
    const holdMs = wantSprint ? 200 : 320
    if (now - this.locoSprintPendingSince >= holdMs) {
      this.locoSprintStable = wantSprint
      this.locoSprintPending = null
    }
    return this.locoSprintStable
  }

  /** Não troca clip de loco mais rápido que isso (anti-tremor). */
  private canSwitchLocoClip(target: PlayerLocoAnim): boolean {
    if (this.current === target) return true
    const now = performance.now()
    // run ↔ walk é o pior caso
    const runWalk =
      (this.current === 'player_run' && target === 'player_walking') ||
      (this.current === 'player_walking' && target === 'player_run')
    const minGap = runWalk ? 340 : 160
    if (now - this.lastLocoSwitchAt < minGap) return false
    return true
  }

  private applyLocoTarget(target: PlayerLocoAnim) {
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
    if (!this.canSwitchLocoClip(target)) {
      // Não mexe timeScale nem clip — evita tremor
      return
    }
    this.lastLocoSwitchAt = performance.now()
    this.transition(this.current, target, { warp: true })
  }

  private returnToLocomotion(fromName: PlayerAnim) {
    this.releaseToLocomotion(fromName)
  }

  setStrafeLocomotion(input: StrafeLocoInput) {
    if (this.holdBallActive) return
    if (this.fieldIdleActive && !input.moving) return
    if (isStrike(this.action)) return
    if (this.action && this.action !== 'player_receive' && this.action !== 'player_header') return
    if (this.dribbleTouchUntil > 0) return

    if (input.moving) {
      this.exitFieldIdle()
      this.stopIdleSequence()
    } else if (this.tryPlayRunStopBeforeIdle()) {
      return
    } else {
      this.startIdleSequence()
      return
    }

    const sprint = this.stabilizeLocoSprint(input.sprint)
    const target = resolveStrafeLocoClip(
      input.localForward,
      input.localRight,
      sprint,
    )
    if (this.current === target || this.canSwitchLocoClip(target)) {
      this.strafeSprint = sprint
    }
    this.applyLocoTarget(target)
  }

  setDirectLocomotion(input: { moving: boolean; sprint: boolean }) {
    if (this.holdBallActive) return
    if (this.fieldIdleActive && !input.moving) return
    if (isStrike(this.action)) return
    if (this.action && this.action !== 'player_receive' && this.action !== 'player_header') return
    if (this.dribbleTouchUntil > 0) return

    if (input.moving) {
      this.exitFieldIdle()
      this.stopIdleSequence()
    } else if (this.tryPlayRunStopBeforeIdle()) {
      return
    } else {
      this.startIdleSequence()
      return
    }

    const sprint = this.stabilizeLocoSprint(input.sprint)
    const target = resolveDirectLocoClip(input.moving, sprint)
    if (this.current === target || this.canSwitchLocoClip(target)) {
      this.strafeSprint = sprint
    }
    this.applyLocoTarget(target)
  }

  setCarrierLocomotion(input: StrafeLocoInput) {
    if (this.holdBallActive) return
    if (this.fieldIdleActive && !input.moving) return
    if (isStrike(this.action)) return
    if (this.action && this.action !== 'player_receive' && this.action !== 'player_header') return
    if (this.dribbleTouchUntil > 0) return

    if (input.moving) {
      this.exitFieldIdle()
      this.stopIdleSequence()
    } else if (this.tryPlayRunStopBeforeIdle()) {
      return
    } else {
      this.startIdleSequence()
      return
    }

    const sprint = this.stabilizeLocoSprint(input.sprint)
    const target = resolveCarrierLocoClip(
      input.localForward,
      input.localRight,
      sprint,
    )
    if (this.current === target || this.canSwitchLocoClip(target)) {
      this.strafeSprint = sprint
    }
    this.applyLocoTarget(target)
  }

  /** Se estava andando/correndo, toca run_stop em vez de ir direto pro idle. */
  private tryPlayRunStopBeforeIdle(): boolean {
    if (this.isRunStopping()) return true
    if (isStandingIdleAnim(this.current)) return false
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
    this.stopIdleSequence()

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
    opts?: { onContact?: () => void; onFinished?: () => void; firstTime?: boolean },
  ) {
    if (!isStrike(name)) this.clearStrikeMirror()

    const action = this.actions[name]
    if (!action) {
      opts?.onContact?.()
      opts?.onFinished?.()
      this.clearStrikeMirror()
      return
    }

    this.exitFieldIdle()
    this.stopIdleSequence()
    this.clearListeners()

    const firstTimeShot = !!opts?.firstTime && isShotStrikeAnim(name)
    const scale =
      this.playbackScale(name) * (firstTimeShot ? SHOT_FIRST_TIME_TIME_SCALE_MUL : 1)
    const duration = this.clipSec(name) / Math.max(0.01, scale)
    this.lockUntil = duration
    this.action = name

    this.transition(this.current, name, { warp: false, duration: ACTION_BLEND })
    if (firstTimeShot) {
      action.setEffectiveTimeScale(scale)
    }

    if (opts?.onContact) {
      const ratio = firstTimeShot
        ? SHOT_FIRST_TIME_CONTACT_RATIO
        : name === 'player_throw_in'
          ? THROW_IN_CONTACT_RATIO
          : isStrike(name)
            ? (STRIKE_CONTACT_RATIO[name] ?? 0.35)
            : 0.38
      let delaySec = duration * ratio
      // Chute: espera o pé chegar — first-time bem mais curto
      if (isShotStrikeAnim(name)) {
        delaySec = Math.max(
          delaySec,
          firstTimeShot
            ? SHOT_FIRST_TIME_CONTACT_MIN_DELAY_SEC
            : SHOT_CONTACT_MIN_DELAY_SEC,
        )
      }
      this.contactTimer = setTimeout(() => {
        this.contactTimer = null
        opts.onContact?.()
      }, delaySec * 1000)
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
    opts?: {
      onContact?: () => void
      instantContact?: boolean
      /** Espelha o modelo (chute/passe com pé esquerdo). */
      mirror?: boolean
      /** First-time / antecipação — contato mais cedo, anim mais rápida. */
      firstTime?: boolean
    },
  ) {
    this.applyStrikeMirror(!!opts?.mirror)
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

  /** Comemoração aleatória — root motion livre (igual carrinho / finta). */
  playCelebration(): boolean {
    if (this.action?.startsWith('celebration_')) return true
    const available = PLAYER_CELEBRATION_ANIMS.filter((name) => this.actions[name])
    if (available.length === 0) return false
    const pick = available[Math.floor(Math.random() * available.length)]!
    const action = this.actions[pick]
    if (!action) return false

    this.clearStrikeMirror()
    this.exitFieldIdle()
    this.stopIdleSequence()
    this.clearListeners()
    this.beginRootMotionAction()
    this.lockUntil = this.playbackDurationSec(pick)
    this.action = pick
    this.transition(this.current, pick, { warp: false, duration: ACTION_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== pick) return
      this.clearListeners()
      this.fireRootMotionSnapshot()
      this.releaseToLocomotion(pick)
    }
    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
    return true
  }

  playKnockdown() {
    if (this.action === 'player_trip') return
    const action = this.actions.player_trip
    if (!action) return

    this.clearStrikeMirror()
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

    this.clearStrikeMirror()
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
    this.stopIdleSequence()
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
    this.stopIdleSequence()
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
    this.clearStrikeMirror()
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
    this.clearStrikeMirror()
    this.stopIdleSequence()
    this.exitThrowInHold()
  }
}

export function legacyLocoFromMoving(moving: boolean, sprint: boolean): PlayerLocoAnim {
  if (!moving) return 'player_idle'
  return sprint ? 'player_run' : 'player_walking'
}

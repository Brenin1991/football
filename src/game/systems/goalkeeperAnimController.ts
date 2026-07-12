import * as THREE from 'three'
import type { GoalkeeperAnim, PlayerAnim } from '../types'
import {
  getGkAnimContactRatio,
  getGkAnimDuration,
} from './gkAnimTiming'

const LOCO: GoalkeeperAnim[] = ['gk_idle', 'gk_idle_ball']
const SAVE: GoalkeeperAnim[] = [
  'gk_catch',
  'gk_diving_save_left',
  'gk_diving_save_right',
  'gk_body_save_left',
  'gk_body_save_right',
  'gk_miss_middle',
]
const ONE_SHOT: GoalkeeperAnim[] = [...SAVE, 'gk_hand_pass']

const LOCO_BLEND = 0.28
const SAVE_BLEND = 0.14
const WALK_BLEND = 0.22

type AnimMap = Partial<Record<GoalkeeperAnim | PlayerAnim, THREE.AnimationAction>>

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
  private locomoting = false
  private rootMotionSnapshot: (() => void) | null = null
  private rootMotionSnapshotFired = false
  private rootMotionActive = false

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
        action.clampWhenFinished = false
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

  isLocomoting() {
    return this.locomoting
  }

  getDisplayAnim(): GoalkeeperAnim {
    if (this.action) return this.action
    return this.current
  }

  isBodyLocked() {
    return this.lockUntil > 0 && this.action != null
  }

  /** Defesas / reposições com deslocamento de esqueleto. */
  absorbsRootMotion() {
    return (
      this.rootMotionActive ||
      (this.action != null && (isSave(this.action) || this.action === 'gk_hand_pass'))
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
    this.rootMotionActive = true
  }

  private endRootMotionAction() {
    this.rootMotionActive = false
  }

  clipSec(name: GoalkeeperAnim | PlayerAnim) {
    const clip = this.actions[name]?.getClip()
    return clip && clip.duration > 0.01 ? clip.duration : 1
  }

  playbackDurationSec(name: GoalkeeperAnim | PlayerAnim) {
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

  private transitionToClip(
    fromName: GoalkeeperAnim | PlayerAnim,
    toName: GoalkeeperAnim | PlayerAnim,
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

    const bothLoco =
      (isLoco(fromName as GoalkeeperAnim) ||
        fromName === 'player_run' ||
        fromName === 'player_walking') &&
      (isLoco(toName as GoalkeeperAnim) ||
        toName === 'player_run' ||
        toName === 'player_walking')
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
  }

  private transition(
    fromName: GoalkeeperAnim,
    toName: GoalkeeperAnim,
    opts?: { duration?: number; warp?: boolean; resetNext?: boolean },
  ) {
    this.transitionToClip(fromName, toName, opts)
    if (isLoco(toName)) this.current = toName
  }

  private releaseToIdle(fromName: GoalkeeperAnim | PlayerAnim, to: GoalkeeperAnim) {
    const finished = this.actions[fromName]
    finished?.stop()
    finished?.reset()

    this.action = null
    this.lockUntil = 0
    this.locomoting = false
    this.endRootMotionAction()

    const idle = this.actions[to]
    if (!idle) return

    idle.enabled = true
    idle.reset()
    idle.play()
    idle.setEffectiveWeight(1)
    this.fadeOutOthers(idle, undefined, SAVE_BLEND)
    this.current = to
  }

  private returnToIdle(fromName: GoalkeeperAnim | PlayerAnim, withBall: boolean) {
    const back: GoalkeeperAnim = withBall ? 'gk_idle_ball' : 'gk_idle'
    this.releaseToIdle(fromName, back)
  }

  /** Sai imediatamente da pose de defesa e segura a bola nas mãos. */
  blendToHoldBall() {
    if (this.current === 'gk_idle_ball') return
    if (this.action === 'gk_catch') return
    if (this.action && isSave(this.action)) return

    this.clearListeners()
    this.locomoting = false
    const from = (this.action ?? this.current) as GoalkeeperAnim | PlayerAnim
    this.fireRootMotionSnapshot()

    if (from !== 'gk_catch' && this.actions.gk_catch) {
      this.playCatchToHold(from)
      return
    }

    this.releaseToIdle(from, 'gk_idle_ball')
  }

  /** Transição de defesa → pegar bola → idle com bola */
  playCatchToHold(fromName: GoalkeeperAnim | PlayerAnim = this.current) {
    if (this.action === 'gk_catch' || this.current === 'gk_idle_ball') return

    const catchAction = this.actions.gk_catch
    if (!catchAction) {
      this.releaseToIdle(fromName, 'gk_idle_ball')
      return
    }

    this.clearListeners()
    this.locomoting = false
    this.beginRootMotionAction()
    const duration = this.playbackDurationSec('gk_catch')
    this.lockUntil = duration * 0.65
    this.action = 'gk_catch'
    this.transitionToClip(fromName, 'gk_catch', { warp: false, duration: SAVE_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== catchAction) return
      if (this.action !== 'gk_catch') return
      this.clearListeners()
      this.fireRootMotionSnapshot()
      this.releaseToIdle('gk_catch', 'gk_idle_ball')
    }

    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  forceIdle() {
    if (this.action) return
    this.locomoting = false
    if (this.current === 'gk_idle' && !this.locomoting) return
    this.transition(this.current, 'gk_idle', { warp: true })
  }

  forceIdleWithBall() {
    if (this.action) return
    this.locomoting = false
    if (this.current === 'gk_idle_ball') return
    this.transition(this.current, 'gk_idle_ball', { warp: true })
  }

  /** Usa clip de locomoção do jogador enquanto o goleiro se desloca. */
  playLocomotion(sprinting: boolean) {
    if (this.action) return
    const clip: PlayerAnim = sprinting && this.actions.player_run ? 'player_run' : 'player_walking'
    if (!this.actions[clip]) {
      if (this.current !== 'gk_idle') this.transition(this.current, 'gk_idle', { warp: true })
      return
    }
    this.locomoting = true
    this.transitionToClip(this.current, clip, { warp: true, duration: WALK_BLEND })
  }

  playSave(name: GoalkeeperAnim, onFinished?: () => void) {
    const action = this.actions[name]
    if (!action || !isSave(name)) return

    this.clearListeners()
    this.locomoting = false
    this.beginRootMotionAction()
    this.lockUntil = 0
    const duration = Math.max(
      this.playbackDurationSec(name),
      getGkAnimDuration(name),
    )
    const contactRatio = getGkAnimContactRatio(name)
    this.lockUntil = duration * contactRatio + 0.05
    this.action = name
    this.transition(this.current, name, { warp: false, duration: SAVE_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== name) return
      this.clearListeners()
      this.fireRootMotionSnapshot()
      onFinished?.()
      if (name === 'gk_catch') {
        this.releaseToIdle(name, 'gk_idle_ball')
      } else {
        this.returnToIdle(name, false)
      }
    }

    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  /** Defesa com o pé — passe fraco, bola rasteira, domínio. */
  playFootSave(onContact?: () => void, onFinished?: () => void) {
    const clip: PlayerAnim = this.actions.player_pass ? 'player_pass' : 'player_receive'
    const action = this.actions[clip]
    if (!action) {
      onContact?.()
      onFinished?.()
      return
    }

    this.clearListeners()
    this.locomoting = false
    this.beginRootMotionAction()
    const duration = this.playbackDurationSec(clip)
    this.lockUntil = duration * 0.45
    this.action = null
    this.transitionToClip(this.current, clip, { warp: false, duration: SAVE_BLEND })

    const contactAt = duration * 0.42
    let contacted = false
    const contactTimer = window.setTimeout(() => {
      if (contacted) return
      contacted = true
      onContact?.()
    }, contactAt * 1000)

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      this.clearListeners()
      window.clearTimeout(contactTimer)
      if (!contacted) {
        contacted = true
        onContact?.()
      }
      this.fireRootMotionSnapshot()
      onFinished?.()
      this.returnToIdle(clip, false)
    }

    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => {
      window.clearTimeout(contactTimer)
      this.mixer.removeEventListener('finished', handleFinished)
    }
  }

  playHandPass(onFinished?: () => void) {
    const name: GoalkeeperAnim = 'gk_hand_pass'
    const action = this.actions[name]
    if (!action) {
      onFinished?.()
      return
    }

    this.clearListeners()
    this.locomoting = false
    this.beginRootMotionAction()
    const duration = this.playbackDurationSec(name)
    this.lockUntil = duration * 0.7
    this.action = name
    this.transition(this.current, name, { warp: false, duration: SAVE_BLEND })

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      if (this.action !== name) return
      this.clearListeners()
      this.fireRootMotionSnapshot()
      onFinished?.()
      this.returnToIdle(name, false)
    }

    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => this.mixer.removeEventListener('finished', handleFinished)
  }

  /** Chute com o pé (tiro de meta, punt, reposição longa). */
  playFootKick(onContact?: () => void, onFinished?: () => void) {
    const kickClip: PlayerAnim = this.actions.player_shoot ? 'player_shoot' : 'player_pass'
    const action = this.actions[kickClip]
    if (!action) {
      onContact?.()
      onFinished?.()
      return
    }

    this.clearListeners()
    this.locomoting = false
    this.beginRootMotionAction()
    const duration = this.playbackDurationSec(kickClip)
    this.lockUntil = duration
    this.action = null
    this.transitionToClip(this.current, kickClip, { warp: false, duration: SAVE_BLEND })

    const contactAt = duration * 0.38
    let contacted = false
    const contactTimer = window.setTimeout(() => {
      if (contacted) return
      contacted = true
      onContact?.()
    }, contactAt * 1000)

    const handleFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return
      this.clearListeners()
      window.clearTimeout(contactTimer)
      if (!contacted) {
        contacted = true
        onContact?.()
      }
      this.fireRootMotionSnapshot()
      onFinished?.()
      this.returnToIdle(kickClip, false)
    }

    this.mixer.addEventListener('finished', handleFinished)
    this.finishCleanup = () => {
      window.clearTimeout(contactTimer)
      this.mixer.removeEventListener('finished', handleFinished)
    }
  }

  getAnimTime(): number {
    const name = this.getDisplayAnim()
    return this.actions[name]?.time ?? 0
  }

  dispose() {
    this.clearListeners()
  }
}

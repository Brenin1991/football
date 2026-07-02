import { discoverAllCategories, pickRandomClip } from './audioClipDiscovery'

export type CrowdCategory = 'stand' | 'forward' | 'goal'

export type CrowdForwardReason = 'steal' | 'attack' | 'shot' | 'miss'

const CROWD_BASE = '/sfx/crowd'
const CROWD_CATEGORIES = ['stand', 'forward', 'goal'] as const

const STAND_MIN_GAP_S = 0.15
const STAND_MAX_GAP_S = 1.1
const FORWARD_COOLDOWN_MS = 5200
const GOAL_COOLDOWN_MS = 1200
const ATTACK_THIRD_DIST = 24

const CROWD_VOL = {
  stand: 0.1,
  forwardSteal: 0.2,
  forwardShot: 0.38,
  forwardMiss: 0.32,
  forwardAttack: 0.34,
  goal: 0.5,
} as const

class CrowdSfxManager {
  private unlocked = false
  private ready = false
  private initPromise: Promise<void> | null = null

  private standClips: string[] = []
  private forwardClips: string[] = []
  private goalClips: string[] = []

  private standAudio: HTMLAudioElement | null = null
  private overlayAudio: HTMLAudioElement | null = null
  private lastStandClip: string | null = null
  private standGapTimer: ReturnType<typeof setTimeout> | null = null
  private standWanted = false
  private standVolume: number = CROWD_VOL.stand
  private standTargetVolume: number = CROWD_VOL.stand

  private forwardCooldownUntil = 0
  private goalCooldownUntil = 0
  private attackCheerArmed = true

  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    if (!this.initPromise) {
      this.initPromise = this.init()
    }
  }

  private removeBadClip(list: string[], url: string) {
    const idx = list.indexOf(url)
    if (idx >= 0) list.splice(idx, 1)
  }

  private async init() {
    const discovered = await discoverAllCategories(CROWD_BASE, CROWD_CATEGORIES)
    const stand = discovered.stand ?? []
    const forward = discovered.forward ?? []
    const goal = discovered.goal ?? []

    this.standClips = stand
    this.forwardClips = forward
    this.goalClips = goal
    this.ready = stand.length > 0 || forward.length > 0 || goal.length > 0

    if (import.meta.env.DEV) {
      console.info('[crowd]', {
        stand: stand.length,
        forward: forward.length,
        goal: goal.length,
      })
    }

    if (this.standClips.length > 0) {
      this.standAudio = new Audio()
      this.standAudio.preload = 'auto'
      this.standAudio.volume = this.standVolume
      this.standAudio.addEventListener('ended', () => this.scheduleNextStand())
      this.standAudio.addEventListener('error', () => {
        if (this.lastStandClip) {
          this.removeBadClip(this.standClips, this.lastStandClip)
          this.lastStandClip = null
        }
        this.scheduleNextStand(500)
      })
    }

    this.overlayAudio = new Audio()
    this.overlayAudio.preload = 'auto'
    this.overlayAudio.addEventListener('error', () => {
      /* clip inválido — ignorado */
    })

    if (this.standWanted) {
      this.applyStandState(true)
    }
  }

  private clearStandGap() {
    if (this.standGapTimer !== null) {
      clearTimeout(this.standGapTimer)
      this.standGapTimer = null
    }
  }

  private scheduleNextStand(delayMs?: number) {
    if (!this.standWanted || !this.unlocked || this.standClips.length === 0) return

    this.clearStandGap()
    const gap =
      delayMs ??
      (STAND_MIN_GAP_S + Math.random() * (STAND_MAX_GAP_S - STAND_MIN_GAP_S)) * 1000

    this.standGapTimer = setTimeout(() => {
      this.standGapTimer = null
      this.playNextStand()
    }, gap)
  }

  private playNextStand() {
    if (!this.standWanted || !this.standAudio || this.standClips.length === 0) return

    const src = pickRandomClip(this.standClips)
    if (!src) return

    this.lastStandClip = src
    this.standAudio.src = src
    this.standAudio.volume = this.standVolume
    void this.standAudio.play().catch(() => {
      this.removeBadClip(this.standClips, src)
      this.scheduleNextStand(500)
    })
  }

  private applyStandState(active: boolean) {
    if (!this.unlocked || !this.ready) return

    if (active) {
      if (this.standClips.length === 0) return
      const playing =
        this.standAudio &&
        !this.standAudio.paused &&
        this.standAudio.src &&
        !this.standAudio.ended
      if (!playing) this.playNextStand()
    } else {
      this.clearStandGap()
      this.standAudio?.pause()
      if (this.standAudio) {
        this.standAudio.src = ''
        this.standAudio.load()
      }
    }
  }

  /** Ambiente contínuo — fase de jogo ativa */
  setStandActive(active: boolean) {
    this.standWanted = active
    if (!this.unlocked) return

    if (!this.ready) {
      void this.initPromise?.then(() => this.applyStandState(active))
      return
    }

    this.applyStandState(active)
  }

  private duckStand(multiplier: number, ms: number) {
    this.standTargetVolume = this.standVolume * multiplier
    if (this.standAudio) this.standAudio.volume = this.standTargetVolume
    setTimeout(() => {
      this.standTargetVolume = this.standVolume
      if (this.standAudio && this.standWanted) {
        this.standAudio.volume = this.standVolume
      }
    }, ms)
  }

  private playOverlay(clips: string[], volume: number, duckStand = true) {
    if (!this.unlocked || !this.ready || clips.length === 0 || !this.overlayAudio) return

    const src = pickRandomClip(clips)
    if (!src) return

    this.overlayAudio.pause()
    this.overlayAudio.src = src
    this.overlayAudio.volume = volume
    if (duckStand) this.duckStand(0.55, 2200)
    void this.overlayAudio.play().catch(() => {
      this.removeBadClip(clips, src)
    })
  }

  playForward(reason: CrowdForwardReason = 'attack') {
    if (!this.unlocked || this.forwardClips.length === 0) return
    const now = performance.now()
    if (now < this.forwardCooldownUntil) return

    const volume =
      reason === 'steal'
        ? CROWD_VOL.forwardSteal
        : reason === 'shot'
          ? CROWD_VOL.forwardShot
          : reason === 'miss'
            ? CROWD_VOL.forwardMiss
            : CROWD_VOL.forwardAttack

    this.forwardCooldownUntil = now + FORWARD_COOLDOWN_MS
    this.playOverlay(this.forwardClips, volume, reason !== 'miss')
  }

  playGoal() {
    if (!this.unlocked) return
    const now = performance.now()
    if (now < this.goalCooldownUntil) return
    this.goalCooldownUntil = now + GOAL_COOLDOWN_MS

    if (this.goalClips.length > 0) {
      this.playOverlay(this.goalClips, CROWD_VOL.goal, false)
      if (this.standAudio) this.standAudio.volume = this.standVolume * 0.35
      setTimeout(() => {
        if (this.standAudio && this.standWanted) {
          this.standAudio.volume = this.standVolume
        }
      }, 4500)
      return
    }

    this.playForward('attack')
  }

  notifyHomeSteal() {
    this.playForward('steal')
  }

  notifyHomeShot() {
    this.playForward('shot')
  }

  notifyHomeMiss() {
    this.playForward('miss')
  }

  notifyHomeAttackPush(distToGoal: number) {
    if (!this.attackCheerArmed || distToGoal > ATTACK_THIRD_DIST) return
    this.attackCheerArmed = false
    this.playForward('attack')
  }

  resetAttackCheerArm() {
    this.attackCheerArmed = true
  }

  setStandVolume(volume: number) {
    this.standVolume = volume
    this.standTargetVolume = volume
    if (this.standAudio && this.standWanted) {
      this.standAudio.volume = volume
    }
  }
}

export const crowdSfx = new CrowdSfxManager()

export { ATTACK_THIRD_DIST }

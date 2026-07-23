import { discoverAllCategories } from './audioClipDiscovery'
import { ATTACK_THIRD_DIST } from './crowdSfx'

const NARRATION_BASE = '/sfx/narracao'

export const NARRATION_CATEGORIES = [
  'intro',
  'kickoff',
  'goal',
  'forward',
  'get_ball',
  'kick',
  'kick_error',
  'red_card',
  'foul',
  'yellow_card',
  'lost_ball',
  'pass_ball',
  'pass_error',
] as const

export type NarrationCategory = (typeof NARRATION_CATEGORIES)[number]

export type BallReleaseKind = 'pass' | 'through' | 'cross' | 'shot' | 'setpiece'

const PRIORITY: Record<NarrationCategory, number> = {
  goal: 100,
  intro: 96,
  kickoff: 92,
  red_card: 94,
  kick: 90,
  kick_error: 85,
  yellow_card: 83,
  foul: 81,
  pass_error: 78,
  get_ball: 72,
  lost_ball: 68,
  pass_ball: 52,
  forward: 50,
}

const VOLUME: Partial<Record<NarrationCategory, number>> = {
  intro: 0.9,
  kickoff: 0.88,
  goal: 0.92,
  red_card: 0.88,
  kick: 0.82,
  kick_error: 0.78,
  yellow_card: 0.82,
  foul: 0.8,
  get_ball: 0.8,
  pass_error: 0.76,
  lost_ball: 0.74,
  pass_ball: 0.72,
  forward: 0.7,
}

const GOAL_MAX_MS = 10_000
const FORWARD_COOLDOWN_MS = 5200
const INTERRUPT_MIN_PLAY_MS = 1500
const INTERRUPT_PRIORITY_GAP = 20
const INTRO_LINE_GAP_MS = 700

/** Só estes cortam imediatamente qualquer fala */
const HARD_INTERRUPT = new Set<NarrationCategory>(['goal', 'red_card'])

const CATEGORY_COOLDOWN_MS: Partial<Record<NarrationCategory, number>> = {
  intro: 30_000,
  kickoff: 25_000,
  goal: 6000,
  red_card: 8000,
  kick: 4500,
  kick_error: 5000,
  yellow_card: 6000,
  foul: 5000,
  pass_error: 4500,
  get_ball: 2200,
  lost_ball: 4000,
  pass_ball: 2200,
  forward: FORWARD_COOLDOWN_MS,
}

type PendingLine = { category: NarrationCategory; force: boolean }

class NarrationSfxManager {
  private unlocked = false
  private ready = false
  private initPromise: Promise<void> | null = null

  private clips: Partial<Record<NarrationCategory, string[]>> = {}
  private decks = new Map<NarrationCategory, string[]>()
  private audio: HTMLAudioElement | null = null
  private playing = false
  private currentCategory: NarrationCategory | null = null
  private playToken = 0
  private playStartedAt = 0

  private categoryCooldownUntil: Partial<Record<NarrationCategory, number>> = {}
  private lastTurnoverAt = 0
  private attackPushArmed: Record<'home' | 'away', boolean> = { home: true, away: true }
  private forwardCooldownUntil = 0
  private goalMaxTimer: ReturnType<typeof setTimeout> | null = null
  private pending: PendingLine | null = null

  private introSequenceActive = false
  private introSequencePending = false
  private introSequenceQueue: string[] = []
  private introSequenceIdx = 0
  private introGapTimer: ReturnType<typeof setTimeout> | null = null

  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    if (!this.initPromise) {
      this.initPromise = this.init()
    }
    if (this.introSequencePending) {
      this.introSequencePending = false
      this.runIntroSequence()
    }
  }

  private async init() {
    const discovered = await discoverAllCategories(NARRATION_BASE, NARRATION_CATEGORIES)
    this.clips = discovered as Partial<Record<NarrationCategory, string[]>>

    for (const cat of NARRATION_CATEGORIES) {
      this.newDeck(cat)
    }

    this.ready = NARRATION_CATEGORIES.some((c) => (this.clips[c]?.length ?? 0) > 0)

    if (import.meta.env.DEV) {
      console.info(
        '[narracao]',
        Object.fromEntries(NARRATION_CATEGORIES.map((c) => [c, this.clips[c]?.length ?? 0])),
      )
    }

    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.addEventListener('ended', () => this.onClipDone())
    this.audio.addEventListener('error', () => this.onClipDone())
  }

  private shuffle<T>(items: T[]): T[] {
    const arr = [...items]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  private newDeck(category: NarrationCategory) {
    const clips = this.clips[category] ?? []
    if (clips.length === 0) return
    this.decks.set(category, this.shuffle(clips))
  }

  private getClips(category: NarrationCategory): string[] {
    return this.clips[category] ?? []
  }

  private priority(category: NarrationCategory): number {
    return PRIORITY[category]
  }

  private drawClip(category: NarrationCategory): string | null {
    const clips = this.getClips(category)
    if (clips.length === 0) return null

    let deck = this.decks.get(category)
    if (!deck || deck.length === 0) {
      this.newDeck(category)
      deck = this.decks.get(category)
    }
    if (!deck || deck.length === 0) return null

    return deck.pop()!
  }

  private clearGoalMaxTimer() {
    if (this.goalMaxTimer !== null) {
      clearTimeout(this.goalMaxTimer)
      this.goalMaxTimer = null
    }
  }

  private armGoalMaxTimer(token: number) {
    this.clearGoalMaxTimer()
    this.goalMaxTimer = setTimeout(() => {
      this.goalMaxTimer = null
      if (token !== this.playToken) return
      if (this.currentCategory === 'goal' && this.playing) {
        this.stopCurrent()
      }
    }, GOAL_MAX_MS)
  }

  private stopCurrent() {
    this.clearGoalMaxTimer()
    this.clearIntroGapTimer()
    if (!this.audio) return
    this.playToken++
    this.audio.pause()
    this.audio.currentTime = 0
    this.playing = false
    this.currentCategory = null
  }

  private clearIntroGapTimer() {
    if (this.introGapTimer !== null) {
      clearTimeout(this.introGapTimer)
      this.introGapTimer = null
    }
  }

  private stopIntroSequence() {
    this.introSequenceActive = false
    this.introSequencePending = false
    this.introSequenceQueue = []
    this.introSequenceIdx = 0
    this.clearIntroGapTimer()
  }

  private getIntroSequenceClips(): string[] {
    const clips = this.clips['intro'] ?? []
    return [...clips].sort((a, b) => {
      const fileA = a.split('/').pop() ?? a
      const fileB = b.split('/').pop() ?? b
      const na = parseInt(fileA.match(/\d+/)?.[0] ?? '999', 10)
      const nb = parseInt(fileB.match(/\d+/)?.[0] ?? '999', 10)
      return na - nb
    })
  }

  private runIntroSequence() {
    void this.initPromise?.then(() => {
      if (!this.ready || !this.audio) return

      const clips = this.getIntroSequenceClips()
      if (clips.length === 0) return
      if (this.introSequenceActive) return

      this.introSequenceActive = true
      this.introSequenceQueue = clips
      this.introSequenceIdx = 0
      this.pending = null
      this.stopCurrent()
      this.playNextIntroLine(true)
    })
  }

  private playNextIntroLine(force: boolean) {
    if (!this.audio || !this.introSequenceActive) return

    if (this.introSequenceIdx >= this.introSequenceQueue.length) {
      this.introSequenceActive = false
      return
    }

    const src = this.introSequenceQueue[this.introSequenceIdx]
    this.introSequenceIdx += 1
    void this.play('intro', force, force, src)
  }

  private queueNextIntroLine() {
    if (!this.introSequenceActive) return
    if (this.introSequenceIdx >= this.introSequenceQueue.length) {
      this.introSequenceActive = false
      return
    }

    this.clearIntroGapTimer()
    this.introGapTimer = setTimeout(() => {
      this.introGapTimer = null
      this.playNextIntroLine(true)
    }, INTRO_LINE_GAP_MS)
  }

  private onClipDone() {
    this.clearGoalMaxTimer()
    const finishedCategory = this.currentCategory
    this.playing = false
    this.currentCategory = null

    if (finishedCategory === 'intro' && this.introSequenceActive) {
      if (this.introSequenceIdx < this.introSequenceQueue.length) {
        this.queueNextIntroLine()
        return
      }
      this.introSequenceActive = false
    }

    const next = this.pending
    this.pending = null
    if (next) {
      void this.play(next.category, next.force, false)
    }
  }

  private isCategoryReady(category: NarrationCategory, force: boolean): boolean {
    if (force) return true
    const cd = this.categoryCooldownUntil[category] ?? 0
    return performance.now() >= cd
  }

  /** Interrupção natural — só gol/cartão vermelho cortam na hora; resto espera a fala respirar */
  private canInterrupt(incoming: NarrationCategory, force: boolean): boolean {
    if (!this.playing || !this.currentCategory) return true
    if (force || HARD_INTERRUPT.has(incoming)) return true

    const playedMs = performance.now() - this.playStartedAt
    if (playedMs < INTERRUPT_MIN_PLAY_MS) return false

    const gap = this.priority(incoming) - this.priority(this.currentCategory)
    return gap >= INTERRUPT_PRIORITY_GAP
  }

  private queuePending(category: NarrationCategory, force: boolean) {
    if (
      !this.pending ||
      force ||
      this.priority(category) > this.priority(this.pending.category)
    ) {
      this.pending = { category, force }
    }
  }

  private schedule(category: NarrationCategory, force = false) {
    if (!this.unlocked) return
    void this.initPromise?.then(() => {
      if (!this.ready || !this.audio) return
      if (this.getClips(category).length === 0) return

      if (this.playing) {
        if (this.canInterrupt(category, force)) {
          this.stopCurrent()
          void this.play(category, force, true)
        } else {
          this.queuePending(category, force)
        }
        return
      }

      void this.play(category, force, false)
    })
  }

  private async play(
    category: NarrationCategory,
    force = false,
    interrupted = false,
    explicitSrc?: string,
  ) {
    if (!this.audio) return
    if (
      !force &&
      !interrupted &&
      !explicitSrc &&
      !this.isCategoryReady(category, false)
    ) {
      this.queuePending(category, force)
      return
    }

    const src = explicitSrc ?? this.drawClip(category)
    if (!src) return

    const token = ++this.playToken
    const now = performance.now()
    const cd = CATEGORY_COOLDOWN_MS[category] ?? 2500

    this.playing = true
    this.currentCategory = category
    this.playStartedAt = now
    if (!explicitSrc || category !== 'intro') {
      this.categoryCooldownUntil[category] = now + cd
    }

    this.audio.pause()
    this.audio.currentTime = 0
    this.audio.src = src
    this.audio.volume = VOLUME[category] ?? 0.75

    try {
      await this.audio.play()
      if (category === 'goal') {
        this.armGoalMaxTimer(token)
      }
    } catch {
      if (token !== this.playToken) return
      this.playing = false
      this.currentCategory = null
      const list = this.clips[category]
      if (list) {
        const idx = list.indexOf(src)
        if (idx >= 0) list.splice(idx, 1)
      }
      this.onClipDone()
    }
  }

  playGoal() {
    if (!this.unlocked) return
    void this.initPromise?.then(() => {
      if (!this.ready || !this.audio) return
      this.pending = null
      this.stopCurrent()
      void this.play('goal', true, true)
    })
  }

  /** Para a sequência de narração da intro (ex.: skip) */
  stopIntroNarration() {
    this.stopIntroSequence()
    this.introSequencePending = false
  }

  /** Toca todos os clips de intro em sequência (01 → 02 → …) */
  playIntro() {
    if (!this.unlocked) {
      this.introSequencePending = true
      return
    }
    this.runIntroSequence()
  }

  /** Saída de bola — toca no chute inicial do centro do campo */
  playKickoff() {
    if (!this.unlocked) return
    this.stopIntroSequence()
    void this.initPromise?.then(() => {
      if (!this.ready || !this.audio) return
      if (this.getClips('kickoff').length === 0) return
      this.pending = null
      this.stopCurrent()
      void this.play('kickoff', true, true)
    })
  }

  /** Igual torcida: 1 vez por avanço no terço, cooldown 5,2s, não corta fala em andamento */
  notifyAttackPush(team: 'home' | 'away', distToGoal: number) {
    if (!this.attackPushArmed[team] || distToGoal > ATTACK_THIRD_DIST) return

    const now = performance.now()
    if (now < this.forwardCooldownUntil) return

    this.attackPushArmed[team] = false
    this.forwardCooldownUntil = now + FORWARD_COOLDOWN_MS
    this.schedule('forward')
  }

  resetAttackPushArm(team?: 'home' | 'away') {
    if (team) {
      this.attackPushArmed[team] = true
      return
    }
    this.attackPushArmed.home = true
    this.attackPushArmed.away = true
  }

  playKick() {
    this.schedule('kick')
  }

  playKickError() {
    this.schedule('kick_error')
  }

  playFoul() {
    this.schedule('foul')
  }

  playYellowCard() {
    this.schedule('yellow_card')
  }

  playRedCard() {
    this.schedule('red_card')
  }

  playPassBall() {
    if (Math.random() > 0.55) return
    this.schedule('pass_ball')
  }

  playPassError() {
    this.schedule('pass_error')
  }

  playGetBall() {
    this.schedule('get_ball')
  }

  playLostBall() {
    const now = performance.now()
    if (now - this.lastTurnoverAt < 2500) return
    this.lastTurnoverAt = now
    this.schedule('lost_ball')
  }

  playTurnover(kind: 'pass_error' | 'get_ball' | 'lost_ball') {
    if (kind === 'pass_error') {
      this.schedule('pass_error')
      return
    }
    if (kind === 'get_ball') {
      this.playGetBall()
      return
    }
    this.playLostBall()
  }

  notifyBallRelease(releaseKind?: BallReleaseKind) {
    if (releaseKind === 'shot') {
      this.playKick()
      return
    }
    if (
      releaseKind === 'pass' ||
      releaseKind === 'through' ||
      releaseKind === 'cross'
    ) {
      this.playPassBall()
    }
  }
}

export const narrationSfx = new NarrationSfxManager()

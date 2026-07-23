import { crowdSfx } from './crowdSfx'
import { narrationSfx } from './narrationSfx'
import { menuSfx } from '../../menu/menuSfx'

const WHISTLE_STOP_SRC = '/sfx/apito.mp3'
const WHISTLE_GOAL_SRC = '/sfx/apito_goal.mp3'
const WHISTLE_START_SRC = '/sfx/apito_start.mp3'
const KICK_SRC = '/sfx/kick.mp3'
const POST_SRC = '/sfx/post.mp3'

class SfxManager {
  private kick: HTMLAudioElement | null = null
  private unlocked = false
  private lastPostAt = 0

  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    menuSfx.unlock()
    crowdSfx.unlock()
    narrationSfx.unlock()
    this.kick = new Audio(KICK_SRC)
    this.kick.preload = 'auto'
    this.kick.load()
    for (const src of [WHISTLE_STOP_SRC, WHISTLE_GOAL_SRC, WHISTLE_START_SRC, POST_SRC]) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audio.load()
    }
  }

  private playClip(src: string, volume: number) {
    this.unlock()
    if (!this.unlocked) return
    try {
      const audio = new Audio(src)
      audio.volume = volume
      void audio.play().catch(() => {
        /* arquivo ausente ou autoplay bloqueado */
      })
    } catch {
      /* ignore */
    }
  }

  /** Falta, impedimento, bola fora, intervalo, fim de jogo */
  playWhistle() {
    this.playClip(WHISTLE_STOP_SRC, 0.72)
  }

  /** Gol validado */
  playWhistleGoal() {
    this.playClip(WHISTLE_GOAL_SRC, 0.78)
  }

  /** Saída de bola / reinício de jogo */
  playWhistleStart() {
    this.playClip(WHISTLE_START_SRC, 0.74)
  }

  playKick() {
    this.playClip(KICK_SRC, 0.55)
  }

  /** Bola na trave / travessão */
  playPost(intensity = 1) {
    const now = performance.now()
    if (now - this.lastPostAt < 120) return
    this.lastPostAt = now
    const vol = Math.max(0.35, Math.min(0.92, 0.45 + intensity * 0.45))
    this.playClip(POST_SRC, vol)
  }
}

export const sfx = new SfxManager()

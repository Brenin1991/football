import { crowdSfx } from './crowdSfx'
import { narrationSfx } from './narrationSfx'
import { menuSfx } from '../../menu/menuSfx'

const WHISTLE_SRC = '/sfx/apito.mp3'
const KICK_SRC = '/sfx/kick.mp3'

class SfxManager {
  private whistle: HTMLAudioElement | null = null
  private kick: HTMLAudioElement | null = null
  private unlocked = false

  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    menuSfx.unlock()
    crowdSfx.unlock()
    narrationSfx.unlock()
    this.whistle = new Audio(WHISTLE_SRC)
    this.whistle.preload = 'auto'
    this.kick = new Audio(KICK_SRC)
    this.kick.preload = 'auto'
    this.whistle.load()
    this.kick.load()
  }

  private playClip(src: string, volume: number) {
    if (!this.unlocked) return
    try {
      const audio = new Audio(src)
      audio.volume = volume
      void audio.play().catch(() => {
        /* arquivo ausente ou formato inválido */
      })
    } catch {
      /* ignore */
    }
  }

  playWhistle() {
    this.playClip(WHISTLE_SRC, 0.72)
  }

  playKick() {
    this.playClip(KICK_SRC, 0.55)
  }
}

export const sfx = new SfxManager()

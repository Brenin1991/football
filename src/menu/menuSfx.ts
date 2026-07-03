const MENU_SFX = {
  navigate: '/sfx/menu/navegate.wav',
  open: '/sfx/menu/open.wav',
  select: '/sfx/menu/select.wav',
} as const

class MenuSfxManager {
  private unlocked = false

  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    Object.values(MENU_SFX).forEach((src) => {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audio.load()
    })
  }

  private play(src: string, volume: number) {
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

  playNavigate() {
    this.play(MENU_SFX.navigate, 0.62)
  }

  playOpen() {
    this.play(MENU_SFX.open, 0.68)
  }

  playSelect() {
    this.play(MENU_SFX.select, 0.72)
  }
}

export const menuSfx = new MenuSfxManager()

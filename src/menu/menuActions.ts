import { menuSfx } from './menuSfx'

export function withMenuNavigate<T extends (...args: never[]) => void>(fn: T): T {
  return ((...args: never[]) => {
    menuSfx.playNavigate()
    fn(...args)
  }) as T
}

export function withMenuSelect<T extends (...args: never[]) => void>(fn: T): T {
  return ((...args: never[]) => {
    menuSfx.playSelect()
    fn(...args)
  }) as T
}

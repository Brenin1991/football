import { useEffect, useState } from 'react'
import { subscribeScreenFade } from '../systems/screenTransition'

export function ScreenFade() {
  const [opacity, setOpacity] = useState(0)

  useEffect(() => subscribeScreenFade(setOpacity), [])

  if (opacity <= 0.001) return null

  return (
    <div
      className="screen-fade"
      style={{ opacity }}
      aria-hidden
    />
  )
}

import { useEffect, useState } from 'react'
import { replaySystem } from '../systems/replaySystem'
import { subscribeScreenFade } from '../systems/screenTransition'
import { useGameStore } from '../store/gameStore'

export function ReplayOverlay() {
  const phase = useGameStore((s) => s.phase)
  const [fadeOpacity, setFadeOpacity] = useState(0)
  const [, tick] = useState(0)

  useEffect(() => subscribeScreenFade(setFadeOpacity), [])

  useEffect(() => {
    if (phase !== 'replay') return
    const id = window.setInterval(() => tick((n) => n + 1), 100)
    return () => window.clearInterval(id)
  }, [phase])

  const tvVisible = replaySystem.isTvHudVisible() && fadeOpacity < 0.35
  if (!tvVisible) return null

  const label = replaySystem.getEventLabel()
  const highlight = replaySystem.getReplayHighlight()
  const progress = Math.round(replaySystem.getPlaybackProgress() * 100)

  return (
    <div className="psx-replay-overlay pes-hud-shell" aria-hidden>
      <div className="psx-replay-scanlines" />

      <div className="psx-replay-tag pes-hud-surface pes-hud-surface--header">
        <span className="psx-replay-dot" />
        REPLAY
      </div>

      <div className="psx-replay-lower pes-hud-surface">
        {highlight ? (
          <div className="psx-replay-highlight">
            <div className="psx-replay-player">{highlight.playerName}</div>
            <div className="psx-replay-action">{highlight.action}</div>
          </div>
        ) : (
          <div className="psx-replay-event">{label}</div>
        )}
        <div className="psx-replay-progress">
          <div className="psx-replay-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}

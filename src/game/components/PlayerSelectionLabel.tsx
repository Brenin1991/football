import { Html } from '@react-three/drei'
import { PLAYER_HEIGHT } from '../constants'
import { getPlayerDisplayName, parsePlayerIndex } from '../data/playerRoster'
import { useGameStore } from '../store/gameStore'
import type { TeamId } from '../types'

type PlayerSelectionLabelProps = {
  team: TeamId
  id: string
}

export function PlayerSelectionLabel({ team, id }: PlayerSelectionLabelProps) {
  const name = getPlayerDisplayName(team, parsePlayerIndex(id))
  const cardState = useGameStore((s) => s.playerCards[id])
  const hasYellowCard = (cardState?.yellow ?? 0) > 0 && !cardState?.red

  return (
    <Html
      position={[0, PLAYER_HEIGHT + 0.06, 0]}
      center
      sprite
      distanceFactor={11}
      zIndexRange={[40, 0]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <div
        className={`psx-player-selection-name${hasYellowCard ? ' psx-player-selection-name--yellow' : ''}`}
      >
        {name}
      </div>
    </Html>
  )
}

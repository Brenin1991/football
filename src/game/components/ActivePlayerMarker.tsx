import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type * as THREE from 'three'
import { getGoalkeeperId } from '../constants'
import { getPlayerBodyY } from '../systems/fieldData'
import { playerRegistry } from '../systems/entityRegistry'
import { getUserTeam, useGameStore } from '../store/gameStore'
import { PlayerSelectionLabel } from './PlayerSelectionLabel'

/** Nome do jogador controlado — um único Html em vez de montar/desmontar em cada Player. */
export function ActivePlayerMarker() {
  const groupRef = useRef<THREE.Group>(null)
  const activeId = useGameStore((s) => s.activePlayerId)
  const userTeam = getUserTeam()
  const gkId = getGoalkeeperId(userTeam)

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const phase = useGameStore.getState().phase
    if (phase === 'replay') {
      group.visible = false
      return
    }

    const id = useGameStore.getState().activePlayerId
    if (!id || id === gkId) {
      group.visible = false
      return
    }

    const player = playerRegistry.get(id)
    if (!player || player.team !== userTeam) {
      group.visible = false
      return
    }

    group.visible = true
    group.position.set(player.position.x, getPlayerBodyY(), player.position.z)
  })

  if (!activeId || activeId === gkId) return null

  return (
    <group ref={groupRef}>
      <PlayerSelectionLabel team={userTeam} id={activeId} />
    </group>
  )
}

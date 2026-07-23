import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import type * as THREE from 'three'
import { PLAYER_HEIGHT } from '../constants'
import { getPlayerBodyY } from '../systems/fieldData'
import { playerRegistry } from '../systems/entityRegistry'
import { useGameStore } from '../store/gameStore'

/** Balão de pedido de bola — segue quem pediu (você ou companheiro IA). */
export function BallCallBubble() {
  const groupRef = useRef<THREE.Group>(null)
  const [visible, setVisible] = useState(false)

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    const store = useGameStore.getState()
    const call = store.ballCall
    const active =
      store.controlMode === 'pro' &&
      !!call &&
      performance.now() < call.until &&
      store.phase === 'playing'

    if (!active || !call) {
      group.visible = false
      setVisible((v) => (v ? false : v))
      return
    }

    const player = playerRegistry.get(call.callerId)
    if (!player) {
      group.visible = false
      setVisible((v) => (v ? false : v))
      return
    }

    group.visible = true
    group.position.set(player.position.x, getPlayerBodyY(), player.position.z)
    setVisible((v) => (v ? v : true))
  })

  return (
    <group ref={groupRef} visible={false}>
      {visible && (
        <Html
          position={[0, PLAYER_HEIGHT + 0.02, 0]}
          center
          sprite
          zIndexRange={[45, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <div className="psx-ball-call-bubble" aria-label="Pedindo a bola">
            <span className="psx-ball-call-bubble__ball" />
          </div>
        </Html>
      )}
    </group>
  )
}

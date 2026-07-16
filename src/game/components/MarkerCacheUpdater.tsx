import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { ballRef } from '../systems/entityRegistry'
import { refreshMarkerCache } from '../systems/dynamicFormation'
import { refreshPhysicsColliderCache } from '../systems/playerFootPhysics'
import { refreshLiveBallState } from '../systems/ballPhysics'
import { refreshCrossVolleyIntentCache } from '../systems/crossAssist'
import { useGameStore } from '../store/gameStore'

/** Atualiza marcadores uma vez por frame (prioridade alta = roda antes dos jogadores) */
export function MarkerCacheUpdater() {
  const frameRef = useRef(0)
  useFrame(() => {
    frameRef.current += 1
    const frame = frameRef.current
    const store = useGameStore.getState()
    refreshCrossVolleyIntentCache(frame)
    refreshLiveBallState(frame)
    refreshMarkerCache(frame, store.ballPossession, ballRef.current)
    refreshPhysicsColliderCache(frame)
  }, -50)
  return null
}

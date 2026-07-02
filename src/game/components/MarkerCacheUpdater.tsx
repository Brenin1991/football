import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { ballRef } from '../systems/entityRegistry'
import { refreshMarkerCache } from '../systems/dynamicFormation'
import { useGameStore } from '../store/gameStore'

/** Atualiza marcadores uma vez por frame (prioridade alta = roda antes dos jogadores) */
export function MarkerCacheUpdater() {
  const frameRef = useRef(0)
  useFrame(() => {
    frameRef.current += 1
    const store = useGameStore.getState()
    refreshMarkerCache(frameRef.current, store.ballPossession, ballRef.current)
  }, -50)
  return null
}

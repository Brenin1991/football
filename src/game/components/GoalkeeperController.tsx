import { useFrame } from '@react-three/fiber'
import { tickGoalkeeperDefense, tryGoalkeeperBoxClaim } from '../systems/goalkeeper'
import { useGameStore } from '../store/gameStore'
import { ballRef, playerRegistry } from '../systems/entityRegistry'
import { isUserPauseActive } from '../systems/gameTime'
import { isFieldParadePhase } from '../systems/matchPhases'

/** Defesas do goleiro — roda antes do MatchManager (prioridade mais alta) */
export function GoalkeeperController() {
  useFrame(() => {
    const store = useGameStore.getState()
    if (
      store.phase !== 'playing' ||
      store.ballFrozen ||
      isUserPauseActive() ||
      isFieldParadePhase(store.phase)
    ) {
      return
    }

    tickGoalkeeperDefense()

    if (store.ballPossession) return

    const gkClaim = tryGoalkeeperBoxClaim([...playerRegistry.values()])
    if (gkClaim && store.canPlayerClaimBall(gkClaim.id)) {
      store.setPossession(gkClaim.id, gkClaim.team)
      store.setLastTouch(gkClaim.team)
      ballRef.velocity = { x: 0, y: 0, z: 0 }
    }
  }, -80)

  return null
}

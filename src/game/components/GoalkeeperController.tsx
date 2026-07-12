import { useFrame } from '@react-three/fiber'
import { tickGoalkeeperDefense, tryGkFeetClaim } from '../systems/goalkeeper'
import { useGameStore } from '../store/gameStore'
import { isUserPauseActive } from '../systems/gameTime'
import { isFieldParadePhase } from '../systems/matchPhases'

/** Defesas do goleiro — contato físico decide pega ou espalma */
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

    if (!store.ballPossession) {
      tryGkFeetClaim()
    }
  }, -80)

  return null
}

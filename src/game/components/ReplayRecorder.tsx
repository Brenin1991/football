import { useFrame } from '@react-three/fiber'
import { replaySystem } from '../systems/replaySystem'

/** Grava posições da bola e jogadores enquanto a partida está em andamento */
export function ReplayRecorder() {
  useFrame((_, delta) => {
    replaySystem.record(delta)
  }, -60)

  return null
}

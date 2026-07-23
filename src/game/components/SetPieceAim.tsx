import { BALL_RADIUS } from '../constants'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { ballRestY } from '../systems/fieldData'
import { isActiveSetPiecePhase } from '../systems/setPiece'

const SIMPLE_ARROW_LENGTH = 2.2
const DEFAULT_COLOR = '#fbbf24'

/**
 * Mira de cobrança — escanteio / lateral / etc.
 * Falta: sem seta (só bolinha de contato + força).
 */
export function SetPieceAim() {
  const phase = useGameStore((s) => s.phase)
  const ballFrozen = useGameStore((s) => s.ballFrozen)
  const setPieceTeam = useGameStore((s) => s.setPieceTeam)
  const position = useGameStore((s) => s.setPiecePosition)
  const aimAngle = useGameStore((s) => s.setPieceAimAngle)

  if (phase === 'free-kick') return null

  const show =
    isActiveSetPiecePhase(phase) &&
    ballFrozen &&
    setPieceTeam === getUserTeam() &&
    position != null

  if (!show || !position) return null

  const y = ballRestY(BALL_RADIUS) + 0.08
  return (
    <group position={[position.x, y, position.z]} rotation={[0, aimAngle, 0]}>
      <mesh position={[0, 0.04, SIMPLE_ARROW_LENGTH * 0.45]} castShadow={false}>
        <boxGeometry args={[0.1, 0.06, SIMPLE_ARROW_LENGTH * 0.9]} />
        <meshBasicMaterial color={DEFAULT_COLOR} toneMapped={false} />
      </mesh>
      <mesh
        position={[0, 0.04, SIMPLE_ARROW_LENGTH + 0.12]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <coneGeometry args={[0.2, 0.4, 4]} />
        <meshBasicMaterial color="#f59e0b" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <ringGeometry args={[0.14, 0.22, 32]} />
        <meshBasicMaterial
          color="#fde68a"
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

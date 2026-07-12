export type TeamId = 'home' | 'away'

export type MatchPhase =
  | 'kickoff'
  | 'playing'
  | 'goal-celebration'
  | 'replay'
  | 'goal'
  | 'throw-in'
  | 'corner'
  | 'goal-kick'
  | 'free-kick'
  | 'penalty'
  | 'half-time'
  | 'half-time-exit'
  | 'half-time-enter'
  | 'full-time'
  | 'full-time-exit'
  | 'paused'
  | 'intro'

export type OutType = 'sideline' | 'goal-line'

export type PlayerLocoAnim =
  | 'player_idle'
  | 'player_walking'
  | 'player_run'
  | 'player_backward'
  | 'player_left'
  | 'player_right'

export type PlayerStrikeAnim = 'player_pass' | 'player_kick' | 'player_shoot'

export type PlayerActionAnim =
  | PlayerStrikeAnim
  | 'player_tackle'
  | 'player_trip'
  | 'player_header'
  | 'player_receive'
  | 'player_throw_in'
  | 'player_spin'

export type PlayerAnim = PlayerLocoAnim | PlayerActionAnim

export type GoalkeeperAnim =
  | 'gk_idle'
  | 'gk_idle_ball'
  | 'gk_catch'
  | 'gk_diving_save_left'
  | 'gk_diving_save_right'
  | 'gk_body_save_left'
  | 'gk_body_save_right'
  | 'gk_miss_middle'
  | 'gk_hand_pass'

export type PlayerRole = 'gk' | 'def' | 'mid' | 'fwd'

export interface FormationSlot {
  x: number
  z: number
  role: PlayerRole
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface FieldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  center: Vec3
  /** Z da linha de gol onde a CASA marca (face do gol virada pro campo) */
  homeScoringGoalZ: number
  /** Z da linha de gol onde o VISITANTE marca */
  awayScoringGoalZ: number
  goalWidth: number
  goalHeight: number
  corners: Vec3[]
}

export interface GoalZone {
  team: TeamId
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface PlayerState {
  id: string
  team: TeamId
  position: Vec3
  rotation: number
  velocity: Vec3
  anim: PlayerAnim
  isControlled: boolean
}

export interface BallState {
  position: Vec3
  velocity: Vec3
  angularVelocity: Vec3
}

export interface MatchEvent {
  type: 'goal' | 'out' | 'half-time' | 'full-time'
  team?: TeamId
  outType?: OutType
  position?: Vec3
}

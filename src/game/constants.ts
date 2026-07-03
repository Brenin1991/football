import type { TeamId } from './types'
import type { FormationSlot } from './types'

export const PLAYERS_PER_TEAM = 11
export const KICKOFF_PLAYER_INDEX = 9 // atacante na saída de bola

export const MATCH_DURATION = 90 * 60
export const HALF_DURATION = MATCH_DURATION / 2
export const HALF_TIME_EXIT_HOLD = 1.2
export const HALF_TIME_ENTER_HOLD = 2
export const FULL_TIME_EXIT_HOLD = 2.5

/** Altura de referência do tuning original — escala derivada do modelo atual */
export const REF_PLAYER_HEIGHT = 0.89
export const PLAYER_HEIGHT = 0.68
export const WORLD_SCALE = PLAYER_HEIGHT / REF_PLAYER_HEIGHT

/** Ritmo geral — movimento, bola e relógio (+12% sobre o original) */
export const GAME_PACE = 1.12

/** ~4,7 min reais ≈ 45 min de jogo */
export const REAL_SECONDS_PER_GAME_MINUTE = 9 / GAME_PACE

export const PLAYER_RADIUS = 0.11 * WORLD_SCALE
export const PLAYER_SPEED = 2.1 * WORLD_SCALE * GAME_PACE
export const PLAYER_SPRINT_SPEED = 3.35 * WORLD_SCALE * GAME_PACE
export const GK_SPEED = 1.85 * WORLD_SCALE * GAME_PACE
export const GK_RUSH_SPEED = 3.35 * WORLD_SCALE * GAME_PACE
export const GK_TURN_SPEED = 7

/** Alcance do goleiro (m) */
export const GK_REACH_STANDING = 1.38 * WORLD_SCALE
export const GK_REACH_DIVE = 2.28 * WORLD_SCALE
export const GK_REACH_HEIGHT = 2.25
export const GK_CATCH_MAX_SPEED = 11.5 * WORLD_SCALE
export const GK_CLAIM_BOX_SPEED = 8.5 * WORLD_SCALE
export const GK_SAVE_COOLDOWN_MS = 420
export const GK_HOLD_MS = 1100
export const GK_DISTRIBUTE_DELAY_MS = 900

/** Rotação no próprio eixo (rad/s) — valores menores = giro mais humano */
export const PLAYER_TURN_SPEED_AI = 7
export const PLAYER_TURN_SPEED_CONTROLLED = 8.5

/** ~11 cm real na escala do personagem (metade do tuning anterior) */
export const BALL_RADIUS = 0.055 * WORLD_SCALE
export const BALL_MASS = 0.22 * WORLD_SCALE * WORLD_SCALE
/** Quique de bola de futebol no gramado — macio, não pedra */
export const BALL_RESTITUTION = 0.46
export const BALL_FRICTION = 0.48
export const BALL_LINEAR_DAMPING = 0.14
export const BALL_ANGULAR_DAMPING = 0.22

export const KICK_POWER = 2.2 * WORLD_SCALE * GAME_PACE
export const SHOT_SPEED = 11.5 * WORLD_SCALE * GAME_PACE
export const SHOT_LOFT = 0.42
export const PASS_SPEED_MIN = 5 * WORLD_SCALE * GAME_PACE
export const PASS_SPEED_MAX = 9.5 * WORLD_SCALE * GAME_PACE
export const PASS_SPEED_DIST_FACTOR = 0.72
export const PASS_SPEED_BASE = 3.85 * WORLD_SCALE * GAME_PACE
export const DRIBBLE_TOUCH_POWER = 0.35 * WORLD_SCALE

export const LOOSE_BALL_MAX_SPEED = 5.5 * WORLD_SCALE * GAME_PACE
export const PASS_RECEIVE_MAX_SPEED = 9 * WORLD_SCALE * GAME_PACE
export const PASS_INTENT_TIMEOUT_MS = 4500

export const POSSESSION_DISTANCE = 0.45 * WORLD_SCALE
export const POSSESSION_HEIGHT = 0.35 * WORLD_SCALE
export const BALL_FOOT_OFFSET = 0.17 * WORLD_SCALE
export const STEAL_DISTANCE = 0.62 * WORLD_SCALE
export const STEAL_COOLDOWN_MS = 320
/** IA tenta roubo em pé a cada X ms (marcador perto do portador) */
export const STANDING_STEAL_AI_INTERVAL_MS = 1050
export const STANDING_STEAL_AI_CHANCE = 0.36
export const STANDING_STEAL_AI_MAX_DIST = 1.05
export const SLIDE_DURATION_MS = 1000
/** Reservado — carrinho é in-place; alcance físico via SLIDE_REACH em tackle.ts */
export const SLIDE_SPEED = 2.65 * WORLD_SCALE
/** Alcance extra dos pés além do corpo deslizante */
export const SLIDE_REACH = 0.55 * WORLD_SCALE
export const SLIDE_CONTACT_DIST = 1.05 * WORLD_SCALE
export const SLIDE_COOLDOWN_MS = 3200
/** IA só considera carrinho a cada X ms */
export const SLIDE_AI_MIN_INTERVAL_MS = 950
/** Chance base (defensor marcando portador) */
export const SLIDE_AI_ROLL_CHANCE = 0.44
export const SLIDE_AI_MIN_DIST = 0.32
export const SLIDE_AI_MAX_DIST = 1.72
/** Segundo homem perto do portador ainda tenta, com chance reduzida */
export const SLIDE_AI_SECOND_CHANCE_MUL = 0.52
export const CLAIM_DISTANCE = 0.72 * WORLD_SCALE
export const PASS_RECEIVE_DISTANCE = 0.78 * WORLD_SCALE
/** Troca de marcador só se outro jogador estiver claramente mais perto da bola */
export const MARKER_SWITCH_MARGIN = 0.65 * WORLD_SCALE

/** Elevação de passe/chute escalada ao tamanho do jogador */
export const KICK_PASS_LOFT_BASE = 0.22 * WORLD_SCALE
export const KICK_LOFT_HEIGHT = 1.2 * WORLD_SCALE

export const GOAL_CELEBRATION_TIME = 3
export const SET_PIECE_DELAY = 1.5
/** Tempo para o time subir antes do goleiro chutar no tiro de meta */
export const GOAL_KICK_AUTO_DELAY = 2.8
export const KICKOFF_COUNTDOWN = 2
/** Volta à câmera lateral antes do chute no escanteio do jogador */
export const CORNER_KICK_CAMERA_RETURN_DELAY = 0.9
/** Tempo antes da IA cobrar pênalti */
export const PENALTY_AUTO_DELAY = 2.4

export const TEAM_COLORS: Record<TeamId, string> = {
  home: '#3b82f6',
  away: '#ef4444',
}

export const TEAM_NAMES: Record<TeamId, string> = {
  home: 'Brasil',
  away: 'Visitante',
}

export const GK_COLORS: Record<TeamId, string> = {
  home: '#facc15',
  away: '#fb923c',
}

/** 4-4-2 — x: largura (-1..1), z: 0 = meio-campo, 1 = gol próprio */
export const FORMATION_442: FormationSlot[] = [
  { x: 0, z: 0.93, role: 'gk' },
  { x: -0.78, z: 0.74, role: 'def' },
  { x: -0.28, z: 0.78, role: 'def' },
  { x: 0.28, z: 0.78, role: 'def' },
  { x: 0.78, z: 0.74, role: 'def' },
  { x: -0.78, z: 0.5, role: 'mid' },
  { x: -0.28, z: 0.52, role: 'mid' },
  { x: 0.28, z: 0.52, role: 'mid' },
  { x: 0.78, z: 0.5, role: 'mid' },
  { x: -0.35, z: 0.14, role: 'fwd' },
  { x: 0.35, z: 0.14, role: 'fwd' },
]

export function playerId(team: TeamId, index: number): string {
  return `${team}-${index}`
}

export function getGoalkeeperId(team: TeamId): string {
  return playerId(team, 0)
}

export function getKickoffPlayerId(team: TeamId): string {
  return playerId(team, KICKOFF_PLAYER_INDEX)
}

export function getOutfieldIds(team: TeamId): string[] {
  return Array.from({ length: PLAYERS_PER_TEAM - 1 }, (_, i) => playerId(team, i + 1))
}

export function getHomeOutfieldIds(): string[] {
  return getOutfieldIds('home')
}

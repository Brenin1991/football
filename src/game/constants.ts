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
export const GAME_PACE = 0.96

/** ~4,7 min reais ≈ 45 min de jogo */
export const REAL_SECONDS_PER_GAME_MINUTE = 9 / GAME_PACE

export const PLAYER_RADIUS = 0.11 * WORLD_SCALE
export const PLAYER_SPEED = 2.18 * WORLD_SCALE * GAME_PACE
export const PLAYER_SPRINT_SPEED = 3.1 * WORLD_SCALE * GAME_PACE
export const GK_SPEED = 3.85 * WORLD_SCALE * GAME_PACE
export const GK_RUSH_SPEED = 4.35 * WORLD_SCALE * GAME_PACE
export const GK_TURN_SPEED = 9.4

/** Alcance do goleiro (m) */
export const GK_REACH_STANDING = 2.38 * WORLD_SCALE
export const GK_REACH_DIVE = 1.28 * WORLD_SCALE
export const GK_REACH_HEIGHT = 2.25
export const GK_CATCH_MAX_SPEED = 14.5 * WORLD_SCALE
export const GK_CLAIM_BOX_SPEED = 10.5 * WORLD_SCALE
/** Bola rasteira/fraca — goleiro domina com os pés como jogador de linha */
export const GK_FEET_CLAIM_MAX_SPEED = 3.6 * WORLD_SCALE
export const GK_FEET_CLAIM_MAX_HEIGHT = 0.55 * WORLD_SCALE
export const GK_SAVE_COOLDOWN_MS = 140
/** Antecipa o mergulho — tempo antes da bola chegar para iniciar a animação */
export const GK_DIVE_COMMIT_LEAD_SEC = 0.78
export const GK_HOLD_MS = 1450
export const GK_DISTRIBUTE_DELAY_MS = 520

/** Esfera de contato em torno dos ossos mixamorig5:LeftHand / RightHand */
export const GK_HAND_RADIUS = 0.48 * WORLD_SCALE
/** Atacante com bola dentro desta distância → body save */
export const GK_CLOSE_ATTACKER_DIST = 6.8 * WORLD_SCALE
/** Quanto o goleiro pode avançar da linha do gol (posicionamento normal) */
export const GK_MAX_STEP_FROM_LINE = 2.65 * WORLD_SCALE
/** Goleiro nunca entra na rede — fica no mínimo esta distância da linha */
export const GK_MIN_FROM_LINE = 0.42 * WORLD_SCALE
/** Avanço máximo em 1v1 / bola perigosa na área */
export const GK_BODY_SAVE_STEP = 5.4 * WORLD_SCALE
/** Limite de rotação em relação ao campo (rad) — não olha para trás */
export const GK_FACING_CLAMP = 1.45
/** Chance de pegar vs espalmar — legado, não usado (decisão é determinística) */
export const GK_CATCH_CHANCE = 0.44

/** Rotação no próprio eixo (rad/s) — pivô off-ball; domínio amortece via momentum */
export const PLAYER_TURN_SPEED_CONTROLLED = 100.8
export const PLAYER_TURN_SPEED_AI = PLAYER_TURN_SPEED_CONTROLLED
/** Jockey perto da bola — giro firme, sem teleporte */
export const PLAYER_TURN_SPEED_BALL_FOCUS = 14
/** Só jockey/marcação perto; corrida usa peito na direção do movimento */
export const BALL_ATTENTION_DIST = 6.5 * WORLD_SCALE
/** Companheiros próximos (candidatos a receber) olham a bola + strafe — só perto/parado */
export const PASS_CANDIDATE_ATTENTION_DIST = 11 * WORLD_SCALE
/** Andar de costas (peito na bola) — mais lento que frente/lado */
export const PASS_CANDIDATE_BACKPEDAL_SPEED = 0.55
export const PASS_CANDIDATE_SIDE_SPEED = 0.82
/** No passe próprio: quem está perto disputa a bola (não a formação) */
export const OWN_PASS_CONTEST_DIST = 9.5 * WORLD_SCALE
export const OWN_PASS_TARGET_CONTEST_DIST = 7.5 * WORLD_SCALE

/** ~11 cm na escala do personagem */
export const BALL_RADIUS = 0.055 * WORLD_SCALE
/** Massa com corpo — leve demais parece pedrinha / gude */
export const BALL_MASS = 0.048 * WORLD_SCALE * WORLD_SCALE
/** Quique de couro no gramado — vivo sem estourar pra cima */
export const BALL_RESTITUTION = 0.48
/** Atrito de bola real — rola e segura no final */
export const BALL_FRICTION = 0.52
/** Amortecimento Rapier leve — o feel fino fica no ground/air drag */
export const BALL_LINEAR_DAMPING = 0.08
/** Amortecimento angular */
export const BALL_ANGULAR_DAMPING = 0.28
/** Drag mínimo no gramado (1/s) */
export const BALL_GROUND_ROLL_MIN = 0.24
/** Drag máximo perto da parada (1/s) */
export const BALL_GROUND_ROLL_MAX = 0.9
/** Velocidade (m/s) em que o drag vai do mínimo ao máximo */
export const BALL_GROUND_ROLL_BLEND = 4.6 * WORLD_SCALE * GAME_PACE
/** Zera só quando praticamente parada */
export const BALL_STOP_SPEED = 0.016 * WORLD_SCALE

/** Trave/travessão metálica — ping realista no rebote */
export const GOAL_FRAME_RESTITUTION = 0.84
export const GOAL_FRAME_FRICTION = 0.18

/** Luvas — atrito alto, rebote moderado (pega ou espalma com física). */
export const GK_HAND_RESTITUTION = 0.48
export const GK_HAND_FRICTION = 0.78
/** Corpo do goleiro (cápsula + ossos na defesa) — bloqueia chute com física real. */
export const GK_BODY_RESTITUTION = 0.44
export const GK_BODY_FRICTION = 0.72
/** Esferas nos ossos — cobrem tronco, braços, pernas, cabeça */
export const GK_BODY_BONE_RADIUS = 0.13 * WORLD_SCALE

/** Colisores de jogador de linha — seguem ossos da animação */
export const PLAYER_FOOT_RADIUS = 0.13 * WORLD_SCALE
export const PLAYER_SLIDE_FOOT_RADIUS = 0.05 * WORLD_SCALE
export const PLAYER_BODY_BONE_RADIUS = 0.12 * WORLD_SCALE
export const PLAYER_BONE_FRICTION = 0.55
export const PLAYER_BONE_RESTITUTION = 0.42

/**
 * Colisores de pé/corpo (Rapier) — domínio e roubo por contato real.
 */
export const PHYSICAL_FOOT_COLLIDERS = true
/**
 * Drible com bola dinâmica + mola — instável em FPS baixo; use cinemático.
 * @deprecated preferir drible cinemático (sempre ativo em BallPhysicsDriver)
 */
export const PHYSICAL_POSSESSION = true
/** @deprecated use PHYSICAL_FOOT_COLLIDERS */
export const PHYSICAL_POSSESSION_LEGACY = PHYSICAL_FOOT_COLLIDERS
/** Raio do colisor do pé — generoso o suficiente pra não falhar o contato */
export const PHYSICAL_FOOT_RADIUS = 0.3 * WORLD_SCALE
/** Distância máxima bola↔pé antes de soltar posse (m) */
export const POSSESSION_LEASH = 0.72 * WORLD_SCALE
/** Mola horizontal bola → alvo de drible */
export const DRIBBLE_PHYSICS_SPRING = 100
export const DRIBBLE_PHYSICS_DAMP = 8.2
export const DRIBBLE_PHYSICS_SPRINT_SPRING = 100

export const KICK_POWER = 2.6 * WORLD_SCALE * GAME_PACE
/** Chute a gol — firme sem ser laser */
export const SHOT_SPEED = 14.5 * WORLD_SCALE * GAME_PACE
export const SHOT_LOFT = 0.18
/** Faixa ampla — curto entrega firme, longo mais forte */
export const PASS_SPEED_MIN = 3.85 * WORLD_SCALE * GAME_PACE
export const PASS_SPEED_MAX = 10.4 * WORLD_SCALE * GAME_PACE
export const PASS_SPEED_DIST_FACTOR = 0.52
export const PASS_SPEED_BASE = 2.55 * WORLD_SCALE * GAME_PACE
/** Drag no ar — leve o bastante pra chute chegar */
export const BALL_AIR_DRAG = 0.074
/** Toque de condução — impulso mais suave, style FIFA */
export const DRIBBLE_TOUCH_POWER = 2.35 * WORLD_SCALE

export const LOOSE_BALL_MAX_SPEED = 12 * WORLD_SCALE * GAME_PACE
/** Teto de claim em passe — acompanha PASS_SPEED_MAX + folga */
export const PASS_RECEIVE_MAX_SPEED = 11.2 * WORLD_SCALE * GAME_PACE
export const PASS_INTENT_TIMEOUT_MS = 4500

export const POSSESSION_DISTANCE = 0.95 * WORLD_SCALE
export const POSSESSION_HEIGHT = 0.35 * WORLD_SCALE
/** Distância bola↔corpo no domínio — PES close control cola nos pés */
export const BALL_FOOT_OFFSET = 0.155 * WORLD_SCALE
export const STEAL_DISTANCE = 0.68 * WORLD_SCALE
export const STEAL_COOLDOWN_MS = 280
/** Roubo automático do jogador — só ao sprintar, intervalo mais espaçado */
export const USER_STEAL_PROXIMITY_INTERVAL_MS = 340
/** IA tenta roubo em pé a cada X ms (marcador perto do portador) */
export const STANDING_STEAL_AI_INTERVAL_MS = 560
export const STANDING_STEAL_AI_CHANCE = 0.62
export const STANDING_STEAL_AI_MAX_DIST = 1.45
export const SLIDE_DURATION_MS = 1000
/** Reservado — carrinho é in-place; alcance físico via SLIDE_REACH em tackle.ts */
export const SLIDE_SPEED = 2.65 * WORLD_SCALE
/** Alcance extra dos pés além do corpo deslizante */
export const SLIDE_REACH = 0.55 * WORLD_SCALE
export const SLIDE_CONTACT_DIST = 1.05 * WORLD_SCALE
/** Batida de corpo feia o bastante pra derrubar / virar falta */
export const SLIDE_HEAVY_BODY_DIST = 0.52 * WORLD_SCALE
export const SLIDE_COOLDOWN_MS = 2400
/** IA só considera carrinho a cada X ms */
export const SLIDE_AI_MIN_INTERVAL_MS = 1200
/** Chance base por função — zagueiro marca pela frente */
export const SLIDE_AI_ROLL_CHANCE_DEF = 0.48
export const SLIDE_AI_ROLL_CHANCE_MID = 0.28
export const SLIDE_AI_ROLL_CHANCE_FWD = 0.12
export const SLIDE_AI_MIN_DIST = 0.38
export const SLIDE_AI_MAX_DIST = 1.58
/** Segundo homem também pode carrinhar */
export const SLIDE_AI_SECOND_CHANCE_MUL = 0.38
/** Carrinho na linha de passe (interceptação) */
export const SLIDE_AI_INTERCEPT_CHANCE_DEF = 0.48
export const SLIDE_AI_INTERCEPT_CHANCE_MID = 0.28
export const SLIDE_AI_INTERCEPT_CHANCE_FWD = 0.12
/** Disputa de corpo longa — carrinho para tentar soltar a bola */
export const PHYSICAL_DUEL_SLIDE_MIN_MS = 200
export const SLIDE_AI_DUEL_CHANCE_DEF = 0.38
export const SLIDE_AI_DUEL_CHANCE_MID = 0.22
export const SLIDE_AI_DUEL_CHANCE_FWD = 0.12
/** Zagueiro perto do gol — carrinho obrigatório na prática */
export const SLIDE_AI_GOAL_BOX_CHANCE_DEF = 0.94
export const SLIDE_AI_GOAL_DANGER_CHANCE_DEF = 0.8
export const SLIDE_AI_GOAL_BOX_MAX_DIST = 1.68
export const SLIDE_AI_GOAL_DANGER_MAX_DIST = 1.52
export const SLIDE_AI_GOAL_BOX_INTERVAL_MUL = 0.28
export const CLAIM_DISTANCE = 0.42 * WORLD_SCALE
export const PASS_RECEIVE_DISTANCE = 0.55 * WORLD_SCALE
/** Contato pé/corpo ↔ bola para domínio (humano) */
export const CONTACT_CLAIM_FOOT = 0.4 * WORLD_SCALE
export const CONTACT_CLAIM_BODY = 0.5 * WORLD_SCALE
/** IA — um pouco mais generosa */
export const CONTACT_CLAIM_FOOT_AI = 0.5 * WORLD_SCALE
export const CONTACT_CLAIM_BODY_AI = 0.62 * WORLD_SCALE
/** Troca de marcador só se outro jogador estiver claramente mais perto da bola */
export const MARKER_SWITCH_MARGIN = 0.65 * WORLD_SCALE

/** Durante animação de passe/chute — corpo faz warp até o alvo (estilo FIFA) */
export const STRIKE_WARP_TURN_SPEED = 11.2

/** Elevação — passe rasteiro / pico de lob (altura alvo em m) */
export const KICK_PASS_LOFT_BASE = 0.08 * WORLD_SCALE
/** Pico — carga cheia sobe; meia barra não vira lob */
export const KICK_LOFT_HEIGHT = 2.55 * WORLD_SCALE

export const GOAL_CELEBRATION_TIME = 3
export const SET_PIECE_DELAY = 1.5
/** Segundos com a bola rolando fora antes de parar o jogo e cobrar */
export const BALL_OUT_SETTLE_SEC = 0.4
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

/** Wireframes de colisores, gols e áreas — desligar em build final */
export const PHYSICS_DEBUG = false

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
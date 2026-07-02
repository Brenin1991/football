import type { FieldBounds, TeamId, Vec3 } from '../types'
import { getOpponent, useGameStore, type OffsidePassFlag } from '../store/gameStore'
import { ballRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { normalize2D } from './rules'
import { sfx } from './sfx'
import { narrationSfx } from './narrationSfx'
import { getDefensiveGoalZ, getAttackSign, getPenaltySpot, isInPenaltyArea } from './teamField'
import { startFreeKickSetPiece, startPenaltySetPiece } from './setPiece'
import { runScreenTransition, isScreenTransitionActive } from './screenTransition'
import {
  getOffsideLineZ,
  isOffsideAtPass,
} from './offside'
import { ensureBallKinematic } from './ballPhysics'
import { ballRestY } from './fieldData'
import { setBallPosition } from './entityRegistry'
import { replaySystem } from './replaySystem'

export type CardColor = 'yellow' | 'red'
export type FoulReason =
  | 'slide-from-behind'
  | 'dangerous-slide'
  | 'last-man'
  | 'offside'
  | 'second-yellow'

export interface FoulCall {
  foulerId: string
  victimId?: string
  fouledTeam: TeamId
  position: Vec3
  card: CardColor | null
  reason: FoulReason
  message: string
}

export interface RefereeState {
  x: number
  z: number
  targetX: number
  targetZ: number
  showingCard: CardColor | null
  cardTimer: number
}

export const refereeState: RefereeState = {
  x: 2.8,
  z: -2.4,
  targetX: 2.8,
  targetZ: -2.4,
  showingCard: null,
  cardTimer: 0,
}

const REFEREE_STANDOFF = 2.6

function clampReferee(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

/** Juiz nunca fica em cima da bola — posição lateral com distância mínima */
export function getRefereeSpotNearBall(
  ballX: number,
  ballZ: number,
  bounds: FieldBounds,
): { x: number; z: number } {
  const towardCenterZ = bounds.center.z - ballZ
  const sideX = ballX <= bounds.center.x ? -1 : 1

  let x = ballX + sideX * REFEREE_STANDOFF
  let z = ballZ + (towardCenterZ >= 0 ? -1 : 1) * 1.1

  x = clampReferee(x, bounds.minX + 0.9, bounds.maxX - 0.9)
  z = clampReferee(z, bounds.minZ + 0.9, bounds.maxZ - 0.9)

  const dx = x - ballX
  const dz = z - ballZ
  const dist = Math.hypot(dx, dz)
  if (dist < REFEREE_STANDOFF * 0.75) {
    const push = REFEREE_STANDOFF / (dist || 1)
    x = ballX + dx * push
    z = ballZ + dz * push
    x = clampReferee(x, bounds.minX + 0.9, bounds.maxX - 0.9)
    z = clampReferee(z, bounds.minZ + 0.9, bounds.maxZ - 0.9)
  }

  return { x, z }
}

function setRefereeTargetNearBall(ballX: number, ballZ: number, bounds: FieldBounds) {
  const spot = getRefereeSpotNearBall(ballX, ballZ, bounds)
  refereeState.targetX = spot.x
  refereeState.targetZ = spot.z
}

const FOUL_COOLDOWN_MS = 2200
let lastFoulAt = 0
let freeKickTransitionBusy = false

function transitionToFreeKick(
  team: TeamId,
  position: Vec3,
  stopMessage: string,
  setupMessage: string,
  refereeSignal?: { card: 'yellow' | 'red' | null; at: number; playerId: string } | null,
) {
  if (freeKickTransitionBusy || isScreenTransitionActive()) return
  freeKickTransitionBusy = true

  useGameStore.setState({
    ballFrozen: true,
    ballPossession: null,
    passIntent: null,
    message: stopMessage,
  })

  void runScreenTransition(() => {
    ensureBallKinematic()
    setBallPosition(position)
    startFreeKickSetPiece(team, position, setupMessage, refereeSignal ?? null)
    const bounds = useGameStore.getState().fieldBounds
    if (bounds) {
      setRefereeTargetNearBall(position.x, position.z, bounds)
    }
  }).finally(() => {
    freeKickTransitionBusy = false
  })
}

function transitionToPenalty(
  team: TeamId,
  position: Vec3,
  stopMessage: string,
  setupMessage: string,
  refereeSignal?: { card: 'yellow' | 'red' | null; at: number; playerId: string } | null,
) {
  if (freeKickTransitionBusy || isScreenTransitionActive()) return
  freeKickTransitionBusy = true

  useGameStore.setState({
    ballFrozen: true,
    ballPossession: null,
    passIntent: null,
    message: stopMessage,
  })

  void runScreenTransition(() => {
    ensureBallKinematic()
    setBallPosition(position)
    startPenaltySetPiece(team, position, setupMessage, refereeSignal ?? null)
    const bounds = useGameStore.getState().fieldBounds
    if (bounds) {
      setRefereeTargetNearBall(position.x, position.z, bounds)
    }
  }).finally(() => {
    freeKickTransitionBusy = false
  })
}

function resolveFoulSetPiece(
  call: FoulCall,
  cardMsg: string,
  setupMessage: string,
  refereeSignal: { card: 'yellow' | 'red' | null; at: number; playerId: string } | null,
) {
  const fouler = playerRegistry.get(call.foulerId)
  const bounds = useGameStore.getState().fieldBounds
  const isPenalty =
    fouler != null && bounds != null && isInPenaltyArea(call.position, fouler.team, bounds)

  if (isPenalty) {
    const spot = getPenaltySpot(call.fouledTeam, bounds!)
    spot.y = ballRestY()
    transitionToPenalty(
      call.fouledTeam,
      spot,
      `${call.message}${cardMsg} — PÊNALTI`,
      call.fouledTeam === 'home'
        ? `PÊNALTI — ← → mirar · Espaço chutar${cardMsg}`
        : `PÊNALTI — cobrança visitante${cardMsg}`,
      refereeSignal,
    )
    return
  }

  transitionToFreeKick(
    call.fouledTeam,
    call.position,
    `${call.message}${cardMsg}`,
    setupMessage,
    refereeSignal,
  )
}

function approachDot(
  slider: PlayerRef,
  victim: PlayerRef,
  slideDir: { x: number; z: number },
): number {
  const toVictim = normalize2D(
    victim.position.x - slider.position.x,
    victim.position.z - slider.position.z,
  )
  return toVictim.x * slideDir.x + toVictim.z * slideDir.z
}

export function isPlayerSentOff(playerId: string): boolean {
  return useGameStore.getState().sentOffPlayers.includes(playerId)
}

export function canPlayerPlay(playerId: string): boolean {
  return !isPlayerSentOff(playerId)
}

function issueCard(playerId: string, card: CardColor): CardColor {
  const store = useGameStore.getState()
  const cards = { ...store.playerCards }
  const current = cards[playerId] ?? { yellow: 0, red: false }

  if (card === 'yellow') {
    current.yellow += 1
    if (current.yellow >= 2) {
      current.red = true
      cards[playerId] = current
      useGameStore.setState({
        playerCards: cards,
        sentOffPlayers: [...store.sentOffPlayers, playerId],
      })
      return 'red'
    }
    cards[playerId] = current
    useGameStore.setState({ playerCards: cards })
    return 'yellow'
  }

  current.red = true
  cards[playerId] = current
  useGameStore.setState({
    playerCards: cards,
    sentOffPlayers: [...store.sentOffPlayers, playerId],
  })
  return 'red'
}

/** Último homem: nenhum colega de linha entre o agressor e o atacante rumo ao gol */
function isLastDefender(
  fouler: PlayerRef,
  victim: PlayerRef,
  bounds: FieldBounds,
): boolean {
  if (fouler.team === victim.team) return false

  const defGoalZ = getDefensiveGoalZ(fouler.team, bounds)
  const atkSign = getAttackSign(victim.team, bounds)
  const progressFromDefGoal = (z: number) => (z - defGoalZ) * atkSign

  const victimProg = progressFromDefGoal(victim.position.z)
  const foulerProg = progressFromDefGoal(fouler.position.z)

  // Atacante avançando em direção ao gol — agressor deve ser o último defensor no corredor
  if (victimProg <= foulerProg + 0.4) return false
  if (Math.abs(victim.position.x - fouler.position.x) > 14) return false

  for (const mate of playerRegistry.values()) {
    if (mate.team !== fouler.team || mate.role === 'gk' || mate.id === fouler.id) continue
    if (isPlayerSentOff(mate.id)) continue

    const mateProg = progressFromDefGoal(mate.position.z)
    if (mateProg <= foulerProg + 0.25) continue
    if (mateProg > victimProg + 1.5) continue
    if (Math.abs(mate.position.x - victim.position.x) > 14) continue
    return false
  }

  return true
}

export function classifySlideContact(
  slider: PlayerRef,
  victim: PlayerRef,
  slideDir: { x: number; z: number },
  victimHasBall: boolean,
): { isFoul: boolean; card: CardColor | null; reason: FoulReason; message: string } {
  const dot = approachDot(slider, victim, slideDir)
  const fromBehind = dot < 0.2
  const side = dot >= 0.2 && dot < 0.55

  if (victimHasBall) {
    if (fromBehind) {
      return {
        isFoul: true,
        card: 'yellow',
        reason: 'slide-from-behind',
        message: 'FALTA — carrinho por trás',
      }
    }
    if (side) {
      return {
        isFoul: true,
        card: null,
        reason: 'dangerous-slide',
        message: 'FALTA — entrada lateral perigosa',
      }
    }
    return { isFoul: false, card: null, reason: 'dangerous-slide', message: '' }
  }

  const bounds = useGameStore.getState().fieldBounds
  if (bounds && isLastDefender(slider, victim, bounds)) {
    return {
      isFoul: true,
      card: 'red',
      reason: 'last-man',
      message: 'FALTA — último homem',
    }
  }

  // Sem bola: falta normal — cartão só no último homem (vermelho)
  return {
    isFoul: true,
    card: null,
    reason: 'dangerous-slide',
    message: fromBehind
      ? 'FALTA — carrinho imprudente (sem bola)'
      : 'FALTA — contato irregular (sem bola)',
  }
}

function foulSpot(victim: PlayerRef, slider: PlayerRef): Vec3 {
  return {
    x: (victim.position.x + slider.position.x) * 0.5,
    y: ballRestY(),
    z: (victim.position.z + slider.position.z) * 0.5,
  }
}

export function callFoul(call: FoulCall) {
  const store = useGameStore.getState()
  if (store.phase !== 'playing') return
  if (performance.now() - lastFoulAt < FOUL_COOLDOWN_MS) return
  lastFoulAt = performance.now()

  let cardShown: CardColor | null = call.card
  if (call.card) {
    cardShown = issueCard(call.foulerId, call.card)
  }

  const cardMsg =
    cardShown === 'red'
      ? ' — CARTÃO VERMELHO'
      : cardShown === 'yellow'
        ? ' — CARTÃO AMARELO'
        : ''

  refereeState.showingCard = cardShown
  refereeState.cardTimer = cardShown ? 2.4 : 0.8

  const setupMessage =
    call.fouledTeam === 'home'
      ? `${call.message}${cardMsg} — ← → mirar · Espaço chutar`
      : `${call.message}${cardMsg} — cobrança visitante`

  const finishFoul = () => {
    sfx.playWhistle()
    if (cardShown === 'red') {
      narrationSfx.playRedCard()
    } else if (cardShown === 'yellow') {
      narrationSfx.playYellowCard()
    } else {
      narrationSfx.playFoul()
    }
    ensureBallKinematic()
    setBallPosition(call.position)

    resolveFoulSetPiece(
      call,
      cardMsg,
      setupMessage,
      cardShown
        ? { card: cardShown, at: performance.now(), playerId: call.foulerId }
        : null,
    )

    if (cardShown) {
      window.setTimeout(() => {
        useGameStore.setState({ refereeSignal: null })
      }, 1800)
    }
  }

  replaySystem.requestFoulReplay(call.fouledTeam, call.position, finishFoul)
}

export function reportSlideFoul(
  sliderId: string,
  victimId: string,
  slideDir: { x: number; z: number },
  victimHasBall: boolean,
) {
  const slider = playerRegistry.get(sliderId)
  const victim = playerRegistry.get(victimId)
  if (!slider || !victim) return false

  const verdict = classifySlideContact(slider, victim, slideDir, victimHasBall)
  if (!verdict.isFoul) return false

  callFoul({
    foulerId: sliderId,
    victimId,
    fouledTeam: victim.team,
    position: foulSpot(victim, slider),
    card: verdict.card,
    reason: verdict.reason,
    message: verdict.message,
  })
  return true
}

export { isOffsideAtPass } from './offside'

export function getOffsideFlagAtPass(
  attackingTeam: TeamId,
  receiver: PlayerRef,
  bounds: FieldBounds,
  ballZ: number,
): OffsidePassFlag | null {
  if (!isOffsideAtPass(attackingTeam, receiver, bounds, ballZ)) return null
  return {
    attackingTeam,
    receiverId: receiver.id,
    receiverZAtPass: receiver.position.z,
    ballZAtPass: ballZ,
    lineZAtPass: getOffsideLineZ(attackingTeam, bounds),
  }
}

export function tryCallOffsideOnReceive(
  flag: OffsidePassFlag,
  receiverId: string,
): boolean {
  if (flag.receiverId !== receiverId) return false
  const store = useGameStore.getState()
  const bounds = store.fieldBounds
  if (!bounds || store.phase !== 'playing') return false
  callOffside(flag, bounds)
  return true
}

export function callOffside(flag: OffsidePassFlag, _bounds: FieldBounds) {
  const store = useGameStore.getState()
  if (store.phase !== 'playing') return
  if (performance.now() - lastFoulAt < FOUL_COOLDOWN_MS) return
  lastFoulAt = performance.now()

  const receiver = playerRegistry.get(flag.receiverId)
  if (!receiver) return

  const defendingTeam = getOpponent(flag.attackingTeam)
  const spot = {
    x: receiver.position.x,
    y: ballRestY(),
    z: receiver.position.z,
  }

  refereeState.showingCard = null
  refereeState.cardTimer = 0.8

  const finishOffside = () => {
    sfx.playWhistle()
    narrationSfx.playPassError()
    ensureBallKinematic()
    setBallPosition({ x: ballRef.current.x, y: ballRestY(), z: ballRef.current.z })

    transitionToFreeKick(
      defendingTeam,
      spot,
      'IMPEDIMENTO',
      defendingTeam === 'home'
        ? 'IMPEDIMENTO — ← → mirar · Espaço chutar'
        : 'IMPEDIMENTO — cobrança visitante',
    )
  }

  replaySystem.requestOffsideReplay(
    defendingTeam,
    spot,
    flag.lineZAtPass,
    finishOffside,
  )
}

export function updateRefereeFollow(delta: number, bounds: FieldBounds) {
  const ball = ballRef.current
  const store = useGameStore.getState()

  const ballX = store.setPiecePosition?.x ?? ball.x
  const ballZ = store.setPiecePosition?.z ?? ball.z

  if (store.phase === 'playing' && !store.ballFrozen) {
    setRefereeTargetNearBall(ball.x, ball.z, bounds)
  } else if (store.phase === 'replay') {
    // posição vem do buffer do replay
  } else if (
    store.ballFrozen ||
    store.phase === 'kickoff' ||
    store.phase === 'free-kick' ||
    store.phase === 'penalty' ||
    store.phase === 'throw-in' ||
    store.phase === 'corner' ||
    store.phase === 'goal-kick'
  ) {
    setRefereeTargetNearBall(ballX, ballZ, bounds)
  }

  const t = 1 - Math.exp(-5.5 * delta)
  refereeState.x += (refereeState.targetX - refereeState.x) * t
  refereeState.z += (refereeState.targetZ - refereeState.z) * t

  if (refereeState.cardTimer > 0) {
    refereeState.cardTimer = Math.max(0, refereeState.cardTimer - delta)
    if (refereeState.cardTimer <= 0) refereeState.showingCard = null
  }
}

export function whistleForPhase(phase: string) {
  if (
    phase === 'goal' ||
    phase === 'half-time' ||
    phase === 'half-time-exit' ||
    phase === 'full-time' ||
    phase === 'full-time-exit' ||
    phase === 'kickoff' ||
    phase === 'throw-in' ||
    phase === 'corner' ||
    phase === 'goal-kick' ||
    phase === 'penalty'
  ) {
    sfx.playWhistle()
  }
}

export function getSentOffSpot(team: TeamId, bounds: FieldBounds): { x: number; z: number } {
  const sideX = team === 'home' ? bounds.minX - 1.2 : bounds.maxX + 1.2
  const defZ = getDefensiveGoalZ(team, bounds)
  return { x: sideX, z: defZ + (bounds.center.z - defZ) * 0.35 }
}

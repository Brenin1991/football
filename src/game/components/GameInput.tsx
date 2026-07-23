import { useFrame } from '@react-three/fiber'
import type { MutableRefObject } from 'react'
import { useRef } from 'react'
import {
  CORNER_KICK_CAMERA_RETURN_DELAY,
  GOAL_KICK_AUTO_DELAY,
  PENALTY_AUTO_DELAY,
  SET_PIECE_DELAY,
} from '../constants'
import type { ControlState } from '../hooks/useKeyboardControls'
import { playerRegistry } from '../systems/entityRegistry'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { startKickoff, getKickoffPlayerId } from '../systems/kickoff'
import { executeSetPieceDelivery, canSetPiecePassOrCross, isActiveSetPiecePhase, isAttackingFreeKickPresentation } from '../systems/setPiece'
import {
  createShotChargeState,
  finalizePower,
  getPowerChargeDuration,
  getPowerFillSpeed,
  isShotCinematicWindupComplete,
  QUICK_PASS_POWER,
  QUICK_PASS_TAP_MS,
  SHOT_AIM_LOCK_DELAY_MS,
  updatePowerFill,
  type PowerBarMode,
} from '../systems/shotPower'
import { getSimDelta, isUserPauseActive } from '../systems/gameTime'
import {
  computeCameraRelativeAimInput,
  computeCinematicShotAimDirection,
  computeStrikeDirection,
} from '../systems/strikeAim'
import { switchUserPlayer } from '../systems/playerSwitch'
import { canAnticipateStrike, getAnticipatedStrikerId, getPassReceiverId, canManualSwitchPlayer, resolveCrossVolleyStrikerId } from '../systems/anticipation'
import { releaseCrossVolleyShot, isCrossVolleyArmed } from '../systems/crossAssist'
import { getMarkerChargeSpeedMul } from '../systems/markerPressure'
import { replaySystem } from '../systems/replaySystem'
import { finishMatchIntro } from '../systems/matchIntro'
import { clearIntroFade } from '../systems/screenTransition'
import { narrationSfx } from '../systems/narrationSfx'
import { setCameraLookInput, resetCameraLook } from '../systems/cameraLook'

type GameInputProps = {
  controls: MutableRefObject<ControlState>
  consumeKickRelease: () => boolean
  consumeSkipPress?: () => boolean
  clearSkipPress?: () => void
  clearStickyActionEdges?: () => void
}

const AIM_ROTATE_SPEED = 1.15
const CONTACT_MOVE_SPEED = 1.05
const STICK_AIM_DEADZONE = 0.28
/** Curva no stick da cobrança — meia deflexão gira bem menos */
const SET_PIECE_AIM_STICK_EXP = 1.7

type PassChargeKind = 'pass' | 'through' | 'cross'
type ShotContext = 'open' | 'setpiece' | null

function resetChargeState(
  charge: ReturnType<typeof createShotChargeState>,
  refs: {
    chargeMode: MutableRefObject<PowerBarMode>
    shotContext: MutableRefObject<ShotContext>
    chargeStartedAt: MutableRefObject<number>
    cinematicAimLock?: MutableRefObject<{ dirX: number; dirZ: number } | null>
  },
  store: ReturnType<typeof useGameStore.getState>,
) {
  charge.active = false
  charge.power = 0
  refs.chargeMode.current = null
  refs.shotContext.current = null
  refs.chargeStartedAt.current = 0
  if (refs.cinematicAimLock) refs.cinematicAimLock.current = null
  store.setShotCharge(0, false)
}

function fireSetPieceDelivery(
  store: ReturnType<typeof useGameStore.getState>,
  kind: 'shot' | 'pass' | 'cross',
  power: number,
) {
  const finalized = finalizePower(power)
  store.setPendingSetPiecePower(finalized)
  if (kind === 'shot' && (store.phase === 'corner' || store.phase === 'penalty')) {
    store.setSetPieceKickPending(true)
    return
  }
  if (
    kind === 'shot' &&
    store.phase === 'free-kick' &&
    isAttackingFreeKickPresentation(
      store.phase,
      store.setPieceTeam,
      store.setPiecePosition,
      store.fieldBounds,
    )
  ) {
    // Câmera volta do 3ª pessoa atrás do batedor antes do chute
    store.setSetPieceKickPending(true)
    return
  }
  executeSetPieceDelivery(kind, finalized)
}

function fireShotCharge(
  store: ReturnType<typeof useGameStore.getState>,
  shotContext: ShotContext,
  power: number,
) {
  const aim = store.strikeAim
  const finalized = finalizePower(power)
  const ctx =
    shotContext ?? (canChargeOpenPlay(store) ? 'open' : null)

  if (ctx === 'open') {
    store.setPendingUserShot(finalized, aim?.dirX, aim?.dirZ)
  } else if (ctx === 'setpiece') {
    fireSetPieceDelivery(store, 'shot', finalized)
  }
}

/** Chute a gol em jogo aberto: wind-up cinemático (não cobrança / antecipação). */
function isCinematicShotContext(shotContext: ShotContext): boolean {
  return shotContext === 'open'
}

function lockShotAimFromControls(
  store: ReturnType<typeof useGameStore.getState>,
  controls: ControlState,
  power: number,
  lockRef?: MutableRefObject<{ dirX: number; dirZ: number } | null>,
) {
  const possession = store.ballPossession
  const strikerId =
    possession?.team === getUserTeam() && possession.playerId === store.activePlayerId
      ? store.activePlayerId
      : store.activePlayerId
  const player = playerRegistry.get(strikerId)
  if (!player) return

  // Prefere a mira atual (já ajustada na janela livre); senão stick/frente
  const prev = store.strikeAim
  const stick = computeCameraRelativeAimInput(controls)
  const facingX = Math.sin(player.rotation)
  const facingZ = Math.cos(player.rotation)
  let dirX: number
  let dirZ: number
  if (prev && prev.mode === 'shot' && Math.hypot(prev.dirX, prev.dirZ) > 0.01) {
    dirX = prev.dirX
    dirZ = prev.dirZ
  } else if (stick.active) {
    dirX = stick.x
    dirZ = stick.z
  } else {
    dirX = facingX
    dirZ = facingZ
  }
  const len = Math.hypot(dirX, dirZ) || 1
  const nx = dirX / len
  const nz = dirZ / len
  const facingDot = Math.max(-1, Math.min(1, nx * facingX + nz * facingZ))

  if (lockRef) lockRef.current = { dirX: nx, dirZ: nz }

  store.setStrikeAim({
    originX: player.position.x,
    originZ: player.position.z,
    dirX: nx,
    dirZ: nz,
    angle: Math.atan2(nx, nz),
    facingDot,
    mode: 'shot',
    power,
    charging: true,
    locked: true,
  })
}

function tryLockCinematicShotAim(
  store: ReturnType<typeof useGameStore.getState>,
  controls: ControlState,
  chargeStartedAt: number,
  lockRef: MutableRefObject<{ dirX: number; dirZ: number } | null>,
) {
  if (lockRef.current) return
  if (performance.now() - chargeStartedAt < SHOT_AIM_LOCK_DELAY_MS) return
  lockShotAimFromControls(store, controls, store.shotChargePower, lockRef)
}

function strikerHasBall(
  store: ReturnType<typeof useGameStore.getState>,
  strikerId: string,
): boolean {
  const poss = store.ballPossession
  return poss?.team === getUserTeam() && poss.playerId === strikerId
}

function focusAnticipatedStriker(store: ReturnType<typeof useGameStore.getState>) {
  const receiverId = getPassReceiverId(store)
  if (receiverId && receiverId !== store.activePlayerId) {
    store.setActivePlayer(receiverId)
  }
}

function canChargeOpenPlay(store: ReturnType<typeof useGameStore.getState>) {
  if (store.phase !== 'playing' || store.ballFrozen) return false
  const pos = store.ballPossession
  return pos?.team === getUserTeam() && pos.playerId === store.activePlayerId
}

function canChargeSetPiece(store: ReturnType<typeof useGameStore.getState>) {
  if (
    !isActiveSetPiecePhase(store.phase) ||
    !store.ballFrozen ||
    store.setPieceTeam !== getUserTeam()
  ) {
    return false
  }
  // Modo Pro: só cobra se o jogador travado for o cobrador
  if (store.controlMode === 'pro') {
    return store.setPieceKickerId === store.activePlayerId
  }
  return true
}

function canUpdateAnticipationAim(store: ReturnType<typeof useGameStore.getState>) {
  return (
    canAnticipateStrike(store) &&
    store.shotChargeActive &&
    store.powerBarMode != null
  )
}

function updateStrikeAim(
  store: ReturnType<typeof useGameStore.getState>,
  controls: ControlState,
  delta: number,
  cinematicAimLock?: MutableRefObject<{ dirX: number; dirZ: number } | null>,
) {
  if (
    store.phase === 'replay' ||
    store.phase === 'goal-celebration' ||
    store.phase === 'intro' ||
    store.ballFrozen ||
    isActiveSetPiecePhase(store.phase)
  ) {
    store.setStrikeAim(null)
    return
  }

  if (!store.shotChargeActive || !store.powerBarMode) {
    store.setStrikeAim(null)
    return
  }

  const possession = store.ballPossession
  const hasBall =
    possession?.team === getUserTeam() &&
    possession.playerId === store.activePlayerId
  const anticipationAim = canUpdateAnticipationAim(store)

  if (!hasBall && !anticipationAim) {
    store.setStrikeAim(null)
    return
  }

  const strikerId = hasBall
    ? store.activePlayerId
    : getAnticipatedStrikerId(store) ?? store.activePlayerId
  const player = playerRegistry.get(strikerId)
  if (!player) {
    store.setStrikeAim(null)
    return
  }

  const lock = cinematicAimLock?.current
  // Chute cinemático: mira 100% congelada (ref + flag)
  if (store.powerBarMode === 'shot' && (store.strikeAim?.locked || lock)) {
    const dirX = lock?.dirX ?? store.strikeAim!.dirX
    const dirZ = lock?.dirZ ?? store.strikeAim!.dirZ
    const facingX = Math.sin(player.rotation)
    const facingZ = Math.cos(player.rotation)
    const facingDot = Math.max(
      -1,
      Math.min(1, dirX * facingX + dirZ * facingZ),
    )
    store.setStrikeAim({
      originX: player.position.x,
      originZ: player.position.z,
      dirX,
      dirZ,
      angle: Math.atan2(dirX, dirZ),
      facingDot,
      mode: 'shot',
      power: store.shotChargePower,
      charging: true,
      locked: true,
    })
    return
  }

  const prevAim =
    store.strikeAim && store.strikeAim.mode === store.powerBarMode
      ? { x: store.strikeAim.dirX, z: store.strikeAim.dirZ }
      : null
  const rawDir =
    store.powerBarMode === 'shot'
      ? computeCinematicShotAimDirection(controls, player.rotation, prevAim)
      : computeStrikeDirection(controls, player.rotation, prevAim, delta)
  const dir = { x: rawDir.x, z: rawDir.z }
  const facingX = Math.sin(player.rotation)
  const facingZ = Math.cos(player.rotation)
  const facingDot = Math.max(-1, Math.min(1, dir.x * facingX + dir.z * facingZ))

  store.setStrikeAim({
    originX: player.position.x,
    originZ: player.position.z,
    dirX: dir.x,
    dirZ: dir.z,
    angle: Math.atan2(dir.x, dir.z),
    facingDot,
    mode: store.powerBarMode,
    power: store.shotChargePower,
    charging: true,
    locked: false,
  })
}

function setPieceStickAimDelta(moveX: number, simDelta: number): number {
  const abs = Math.abs(moveX)
  if (abs <= STICK_AIM_DEADZONE) return 0
  const remapped = (abs - STICK_AIM_DEADZONE) / (1 - STICK_AIM_DEADZONE)
  const curved = Math.pow(Math.min(1, remapped), SET_PIECE_AIM_STICK_EXP)
  return Math.sign(moveX) * curved * AIM_ROTATE_SPEED * simDelta
}

export function GameInput({
  controls,
  consumeKickRelease,
  consumeSkipPress,
  clearSkipPress,
  clearStickyActionEdges,
}: GameInputProps) {
  const kickoffTimerRef = useRef(0)
  const cornerKickTimerRef = useRef(0)
  const chargeRef = useRef(createShotChargeState())
  const chargeModeRef = useRef<PowerBarMode>(null)
  const shotContextRef = useRef<ShotContext>(null)
  const chargeStartedAtRef = useRef(0)
  const prevShotHeldRef = useRef(false)
  const prevGroundPassHeldRef = useRef(false)
  const prevOtherPassHeldRef = useRef(false)
  const passTapHoldRef = useRef(false)
  const passTapStartedRef = useRef(0)
  const passInAimModeRef = useRef(false)
  const wasCinematicRef = useRef(false)
  const skipGraceRef = useRef(0)
  /** Mira cinemática — sobrevive se o store perder o `locked` */
  const cinematicAimLockRef = useRef<{ dirX: number; dirZ: number } | null>(null)

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    const c = controls.current
    const cinematic =
      store.phase === 'replay' ||
      store.phase === 'goal-celebration' ||
      store.phase === 'intro'

    if (cinematic) {
      store.setStrikeAim(null)
      resetCameraLook()
      // Acabou de entrar: descarta input preso do lance e dá um tempo de graça
      if (!wasCinematicRef.current) {
        wasCinematicRef.current = true
        clearSkipPress?.()
        consumeSkipPress?.()
        skipGraceRef.current = 0.35
      }
      if (skipGraceRef.current > 0) {
        skipGraceRef.current = Math.max(0, skipGraceRef.current - delta)
        clearSkipPress?.()
        consumeSkipPress?.()
        return
      }
      if (consumeSkipPress?.()) {
        if (store.phase === 'intro') {
          clearIntroFade()
          narrationSfx.stopIntroNarration()
          clearStickyActionEdges?.()
          finishMatchIntro()
        } else {
          clearStickyActionEdges?.()
          replaySystem.skip()
        }
      }
      return
    }

    // Stick direito → look da câmera (soltou = volta pra bola)
    setCameraLookInput(c.skillX, c.skillZ)

    if (wasCinematicRef.current) {
      wasCinematicRef.current = false
      skipGraceRef.current = 0
      clearSkipPress?.()
      consumeSkipPress?.()
      clearStickyActionEdges?.()
    }

    if (isUserPauseActive()) {
      store.setStrikeAim(null)
      return
    }

    if (c.toggleAssist) {
      c.toggleAssist = false
      if (store.controlMode === 'pro') {
        store.toggleProAssistMode()
      }
    }

    // LB: cancela carga primeiro; senão pede bola (Pro) / troca (time)
    if (c.cancelCharge && (chargeRef.current.active || passTapHoldRef.current)) {
      c.cancelCharge = false
      c.callForBall = false
      c.switchPlayer = false
      chargeRef.current.active = false
      chargeRef.current.power = 0
      chargeModeRef.current = null
      shotContextRef.current = null
      chargeStartedAtRef.current = 0
      cinematicAimLockRef.current = null
      passTapHoldRef.current = false
      passInAimModeRef.current = false
      store.setShotCharge(0, false)
      store.setStrikeAim(null)
      store.setCrossOneTouchActive(false)
      return
    }

    if (c.callForBall) {
      c.callForBall = false
      store.requestBallCall()
    }

    if (c.switchPlayer && store.phase === 'playing' && !store.ballFrozen && !store.shotChargeActive) {
      c.switchPlayer = false
      if (canManualSwitchPlayer(store)) {
        switchUserPlayer()
      }
    }

    const simDelta = getSimDelta(delta)
    const charge = chargeRef.current

    if (store.setPieceKickPending) {
      cornerKickTimerRef.current += simDelta
      if (cornerKickTimerRef.current >= CORNER_KICK_CAMERA_RETURN_DELAY) {
        executeSetPieceDelivery('shot', store.takePendingSetPiecePower())
        store.setSetPieceKickPending(false)
        cornerKickTimerRef.current = 0
      }
      return
    }

    cornerKickTimerRef.current = 0

    if (store.phase === 'kickoff' && store.ballFrozen) {
      const userKickoff = store.kickoffTeam === getUserTeam()
      const lockedIsKicker =
        store.controlMode !== 'pro' ||
        store.activePlayerId === getKickoffPlayerId(store.kickoffTeam)
      // Rival sempre; em Pro, IA cobra se o jogador travado não for o cobrador
      if (!userKickoff || !lockedIsKicker) {
        kickoffTimerRef.current += simDelta
        if (kickoffTimerRef.current >= SET_PIECE_DELAY) {
          if (startKickoff()) kickoffTimerRef.current = 0
        }
      }
      return
    }

    kickoffTimerRef.current = 0

    const openPlayCharge = canChargeOpenPlay(store)
    const setPieceCharge = canChargeSetPiece(store)
    const anticipateStrike =
      canAnticipateStrike(store) &&
      store.phase === 'playing' &&
      !store.ballFrozen &&
      !openPlayCharge &&
      !setPieceCharge

    if (setPieceCharge) {
      const skillMag = Math.hypot(c.skillX, c.skillZ)
      const usingRightStick = skillMag > STICK_AIM_DEADZONE

      if (store.phase === 'free-kick') {
        // Stick DIREITO = SOMENTE ponto na bola. Nunca mira / rotação.
        if (usingRightStick) {
          const contactMag = Math.min(1, skillMag)
          const contactCurve = Math.pow(contactMag, SET_PIECE_AIM_STICK_EXP)
          store.adjustSetPieceContact(
            // Espelha X — direita/esquerda da bolinha no sentido do cobrador
            -c.skillX * CONTACT_MOVE_SPEED * contactCurve * simDelta,
            c.skillZ * CONTACT_MOVE_SPEED * contactCurve * simDelta,
          )
        } else {
          // Stick ESQUERDO / A-D / D-pad = mira (só com stick direito neutro)
          if (c.left) store.rotateSetPieceAim(-AIM_ROTATE_SPEED * simDelta)
          if (c.right) store.rotateSetPieceAim(AIM_ROTATE_SPEED * simDelta)
          const aimDelta = setPieceStickAimDelta(c.moveX, simDelta)
          if (aimDelta !== 0) store.rotateSetPieceAim(aimDelta)
        }
      } else {
        if (c.left) store.rotateSetPieceAim(-AIM_ROTATE_SPEED * simDelta)
        if (c.right) store.rotateSetPieceAim(AIM_ROTATE_SPEED * simDelta)
        const aimDelta = setPieceStickAimDelta(c.moveX, simDelta)
        if (aimDelta !== 0) store.rotateSetPieceAim(aimDelta)
      }
    }

    // Antecipação: toque rápido OU mira + força (voleio no cruzamento, first-time no passe)
    if (anticipateStrike) {
      const crossInFlight = store.passIntent?.passType === 'cross'
      const strikerId = getAnticipatedStrikerId(store) ?? store.activePlayerId

      const shotHeld = !!c.kick
      const groundPassHeld = !!c.pass
      const otherPassHeld = !!(c.throughPass || c.cross)
      const otherPassButton: PassChargeKind | null = c.cross
        ? 'cross'
        : c.throughPass
          ? 'through'
          : null

      const shotPressed = shotHeld && !prevShotHeldRef.current
      const shotReleased = !shotHeld && prevShotHeldRef.current
      consumeKickRelease()
      const groundPassPressed = groundPassHeld && !prevGroundPassHeldRef.current
      const groundPassReleased = !groundPassHeld && prevGroundPassHeldRef.current
      const otherPassPressed = otherPassHeld && !prevOtherPassHeldRef.current

      // Enquanto segura o chute, mantém o atacante certo focado
      if (shotHeld || (charge.active && chargeModeRef.current === 'shot')) {
        focusAnticipatedStriker(store)
      }

      if (shotPressed && !charge.active && !passTapHoldRef.current) {
        focusAnticipatedStriker(store)
        charge.active = true
        charge.power = 0
        chargeStartedAtRef.current = performance.now()
        chargeModeRef.current = 'shot'
        shotContextRef.current = null
        store.setShotCharge(0, true, 'shot')
        if (crossInFlight) store.setCrossOneTouchActive(true)
      }

      if (shotReleased && charge.active && chargeModeRef.current === 'shot') {
        const power = finalizePower(charge.power)
        const aim = store.strikeAim
        const wasCrossVolley =
          crossInFlight ||
          isCrossVolleyArmed(store, store.activePlayerId) ||
          store.passIntent?.passType === 'cross'
        const strikerId = wasCrossVolley
          ? resolveCrossVolleyStrikerId(store)
          : (getPassReceiverId(store) ?? store.activePlayerId)
        if (strikerId !== store.activePlayerId) {
          store.setActivePlayer(strikerId)
        }
        const dirX = aim?.dirX ?? 0
        const dirZ = aim?.dirZ ?? 1
        resetChargeState(
          charge,
          {
            chargeMode: chargeModeRef,
            shotContext: shotContextRef,
            chargeStartedAt: chargeStartedAtRef,
            cinematicAimLock: cinematicAimLockRef,
          },
          store,
        )
        if (wasCrossVolley) {
          releaseCrossVolleyShot(strikerId, power, dirX, dirZ)
        } else if (strikerHasBall(store, strikerId)) {
          store.setPendingUserShot(power, dirX, dirZ, false, true)
        } else {
          store.setPendingUserShot(power, dirX, dirZ, true, true)
        }
        store.setCrossOneTouchActive(false)
      }
      if (groundPassPressed) {
        focusAnticipatedStriker(store)
        passTapHoldRef.current = true
        passTapStartedRef.current = performance.now()
        passInAimModeRef.current = false
      }

      if (passTapHoldRef.current && groundPassHeld && !passInAimModeRef.current) {
        const tapElapsed = performance.now() - passTapStartedRef.current
        if (tapElapsed >= QUICK_PASS_TAP_MS) {
          passInAimModeRef.current = true
          charge.active = true
          charge.power = 0
          chargeModeRef.current = 'pass'
          chargeStartedAtRef.current = performance.now()
          store.setShotCharge(0, true, 'pass')
        }
      }

      if (passTapHoldRef.current && groundPassReleased) {
        const aim = store.strikeAim
        if (passInAimModeRef.current && charge.active) {
          const power = finalizePower(charge.power)
          resetChargeState(
            charge,
            {
              chargeMode: chargeModeRef,
              shotContext: shotContextRef,
              chargeStartedAt: chargeStartedAtRef,
            cinematicAimLock: cinematicAimLockRef,
            },
            store,
          )
          store.setPendingUserPass('pass', power, true, aim?.dirX, aim?.dirZ)
        } else {
          store.setPendingUserPass('pass', QUICK_PASS_POWER, true, aim?.dirX, aim?.dirZ)
        }
        passTapHoldRef.current = false
        passInAimModeRef.current = false
      }

      if (
        otherPassPressed &&
        otherPassButton === 'through' &&
        !charge.active &&
        !passTapHoldRef.current
      ) {
        focusAnticipatedStriker(store)
        charge.active = true
        charge.power = 0
        chargeStartedAtRef.current = performance.now()
        chargeModeRef.current = 'through'
        store.setShotCharge(0, true, 'through')
      }

      if (charge.active) {
        const mode = chargeModeRef.current
        const duration = getPowerChargeDuration(mode)
        const elapsedMs = performance.now() - chargeStartedAtRef.current
        const aim = store.strikeAim
        const chargeMul =
          mode === 'shot' ? 1 : getMarkerChargeSpeedMul(strikerId, mode)

        if (mode === 'shot') {
          if (shotHeld) {
            updatePowerFill(
              charge,
              simDelta,
              getPowerFillSpeed('shot') * chargeMul,
            )
          }
          store.setShotCharge(charge.power, true, 'shot')
        } else if (mode === 'pass') {
          if (groundPassHeld) {
            updatePowerFill(charge, simDelta, getPowerFillSpeed('pass') * chargeMul)
          }
          store.setShotCharge(charge.power, true, 'pass')
        } else if (mode === 'through') {
          if (otherPassHeld) {
            updatePowerFill(charge, simDelta, getPowerFillSpeed(mode) * chargeMul)
          }
          store.setShotCharge(charge.power, true, mode)

          if (elapsedMs >= duration * 1000 || charge.power >= 1) {
            const power = finalizePower(charge.power)
            resetChargeState(
              charge,
              {
                chargeMode: chargeModeRef,
                shotContext: shotContextRef,
                chargeStartedAt: chargeStartedAtRef,
            cinematicAimLock: cinematicAimLockRef,
              },
              store,
            )
            store.setPendingUserPass('through', power, true, aim?.dirX, aim?.dirZ)
          }
        }
      }

      prevShotHeldRef.current = shotHeld
      prevGroundPassHeldRef.current = groundPassHeld
      prevOtherPassHeldRef.current = otherPassHeld
      updateStrikeAim(store, c, simDelta, cinematicAimLockRef)
      return
    }

    const strikeChargeReady = openPlayCharge || setPieceCharge
    const setPiecePassCross =
      setPieceCharge && canSetPiecePassOrCross(store.phase)
    const passChargeReady = openPlayCharge || setPiecePassCross

    const shotHeld = c.kick && strikeChargeReady
    const groundPassHeld = passChargeReady && c.pass
    const otherPassHeld =
      passChargeReady &&
      (openPlayCharge ? !!(c.throughPass || c.cross) : !!c.cross)
    const otherPassButton: PassChargeKind | null = c.cross
      ? 'cross'
      : c.throughPass && openPlayCharge
        ? 'through'
        : null

    const shotPressed = shotHeld && !prevShotHeldRef.current
    const shotReleased = !shotHeld && prevShotHeldRef.current
    consumeKickRelease()
    const groundPassPressed = groundPassHeld && !prevGroundPassHeldRef.current
    const groundPassReleased = !groundPassHeld && prevGroundPassHeldRef.current
    const otherPassPressed = otherPassHeld && !prevOtherPassHeldRef.current
    const actionHeld = shotHeld || otherPassHeld || (passInAimModeRef.current && groundPassHeld)

    const resolveShotContext = (): ShotContext => {
      if (openPlayCharge) return 'open'
      if (setPieceCharge) return 'setpiece'
      return null
    }

    if (otherPassPressed && !charge.active && !passTapHoldRef.current) {
      charge.active = true
      charge.power = 0
      chargeStartedAtRef.current = performance.now()
      shotContextRef.current = resolveShotContext()
      chargeModeRef.current = otherPassButton
    }

    if (shotPressed && strikeChargeReady && !charge.active && !passTapHoldRef.current) {
      charge.active = true
      charge.power = 0
      chargeStartedAtRef.current = performance.now()
      shotContextRef.current = resolveShotContext()
      chargeModeRef.current = 'shot'
      store.setShotCharge(0, true, 'shot')
      // Janela curta pra mirar — trava depois (tryLockCinematicShotAim)
      if (isCinematicShotContext(shotContextRef.current)) {
        cinematicAimLockRef.current = null
      }
    }

    if (groundPassPressed) {
      passTapHoldRef.current = true
      passTapStartedRef.current = performance.now()
      passInAimModeRef.current = false
      shotContextRef.current = resolveShotContext()
    }

    if (passTapHoldRef.current && groundPassHeld && !passInAimModeRef.current) {
      const tapElapsed = performance.now() - passTapStartedRef.current
      if (tapElapsed >= QUICK_PASS_TAP_MS) {
        passInAimModeRef.current = true
        charge.active = true
        charge.power = 0
        chargeModeRef.current = 'pass'
        chargeStartedAtRef.current = performance.now()
        shotContextRef.current = resolveShotContext()
      }
    }

    if (passTapHoldRef.current && groundPassReleased) {
      const aim = store.strikeAim
      const setCtx = shotContextRef.current === 'setpiece'

      if (passInAimModeRef.current && charge.active) {
        const power = finalizePower(charge.power)
        charge.active = false
        chargeModeRef.current = null
        shotContextRef.current = null
        chargeStartedAtRef.current = 0
        store.setShotCharge(0, false)
        if (setCtx && canSetPiecePassOrCross(store.phase)) {
          fireSetPieceDelivery(store, 'pass', power)
        } else {
          store.setPendingUserPass('pass', power, false, aim?.dirX, aim?.dirZ)
        }
      } else if (!passInAimModeRef.current && openPlayCharge) {
        store.setPendingUserPass('pass', QUICK_PASS_POWER, false, aim?.dirX, aim?.dirZ)
      } else if (!passInAimModeRef.current && setPiecePassCross) {
        fireSetPieceDelivery(store, 'pass', QUICK_PASS_POWER)
      }
      passTapHoldRef.current = false
      passInAimModeRef.current = false
    }

    // Cobrança: ainda solta pra chutar. Jogo aberto: timer cinemático (não solta).
    if (
      shotReleased &&
      charge.active &&
      chargeModeRef.current === 'shot' &&
      !isCinematicShotContext(shotContextRef.current)
    ) {
      const power = finalizePower(charge.power)
      const aim = store.strikeAim
      const shotContext = shotContextRef.current
      const strikerId = resolveCrossVolleyStrikerId(store)
      if (strikerId !== store.activePlayerId) {
        store.setActivePlayer(strikerId)
      }
      const wasCrossVolley =
        store.passIntent?.passType === 'cross' ||
        isCrossVolleyArmed(store, strikerId)
      const dirX = aim?.dirX ?? 0
      const dirZ = aim?.dirZ ?? 1
      resetChargeState(
        charge,
        {
          chargeMode: chargeModeRef,
          shotContext: shotContextRef,
          chargeStartedAt: chargeStartedAtRef,
            cinematicAimLock: cinematicAimLockRef,
        },
        store,
      )
      if (wasCrossVolley) {
        releaseCrossVolleyShot(strikerId, power, dirX, dirZ)
      } else {
        fireShotCharge(store, shotContext, power)
      }
      store.setCrossOneTouchActive(false)
    }

    if (charge.active) {
      const mode = chargeModeRef.current
      const duration = getPowerChargeDuration(mode)
      const elapsedMs = performance.now() - chargeStartedAtRef.current
      const aim = store.strikeAim
      const carrierId = store.ballPossession?.playerId ?? store.activePlayerId
      const chargeMul =
        mode === 'shot' ? 1 : getMarkerChargeSpeedMul(carrierId, mode)
      const cinematicShot =
        mode === 'shot' && isCinematicShotContext(shotContextRef.current)

      // Perdeu a bola no wind-up cinemático — cancela
      if (cinematicShot && !canChargeOpenPlay(store)) {
        resetChargeState(
          charge,
          {
            chargeMode: chargeModeRef,
            shotContext: shotContextRef,
            chargeStartedAt: chargeStartedAtRef,
            cinematicAimLock: cinematicAimLockRef,
          },
          store,
        )
        store.setStrikeAim(null)
      } else if (mode === 'pass') {
        if (groundPassHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed(mode) * chargeMul)
        }
        store.setShotCharge(charge.power, true, 'pass')
      } else if (mode === 'shot') {
        if (shotHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed('shot') * chargeMul)
        }
        store.setShotCharge(charge.power, true, 'shot')

        if (cinematicShot) {
          tryLockCinematicShotAim(
            store,
            c,
            chargeStartedAtRef.current,
            cinematicAimLockRef,
          )
        }

        if (cinematicShot && isShotCinematicWindupComplete(chargeStartedAtRef.current)) {
          const power = finalizePower(charge.power)
          const shotContext = shotContextRef.current
          resetChargeState(
            charge,
            {
              chargeMode: chargeModeRef,
              shotContext: shotContextRef,
              chargeStartedAt: chargeStartedAtRef,
            cinematicAimLock: cinematicAimLockRef,
            },
            store,
          )
          fireShotCharge(store, shotContext, power)
          store.setCrossOneTouchActive(false)
        }
      } else {
        if (actionHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed(mode) * chargeMul)
        }

        store.setShotCharge(charge.power, true, mode)

        if (elapsedMs >= duration * 1000 || charge.power >= 1) {
          const power = finalizePower(charge.power)
          // Capturar antes do reset — resetChargeState zera shotContextRef
          const shotContext = shotContextRef.current
          resetChargeState(
            charge,
            {
              chargeMode: chargeModeRef,
              shotContext: shotContextRef,
              chargeStartedAt: chargeStartedAtRef,
            cinematicAimLock: cinematicAimLockRef,
            },
            store,
          )

          if (mode === 'through' || mode === 'cross') {
            if (shotContext === 'setpiece' && canSetPiecePassOrCross(store.phase)) {
              fireSetPieceDelivery(store, mode === 'cross' ? 'cross' : 'pass', power)
            } else {
              store.setPendingUserPass(mode, power, false, aim?.dirX, aim?.dirZ)
            }
          }
        }
      }
    }

    prevShotHeldRef.current = shotHeld
    prevGroundPassHeldRef.current = groundPassHeld
    prevOtherPassHeldRef.current = otherPassHeld

    updateStrikeAim(store, c, simDelta, cinematicAimLockRef)
  })

  return null
}

export function getAiSetPieceKickDelay(phase: string): number {
  if (phase === 'goal-kick') return GOAL_KICK_AUTO_DELAY
  if (phase === 'penalty') return PENALTY_AUTO_DELAY
  return SET_PIECE_DELAY
}

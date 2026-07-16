import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  PASS_INTENT_TIMEOUT_MS,
  PASS_SPEED_MAX,
  PASS_SPEED_BASE,
  PASS_SPEED_MIN,
} from '../constants'
import {
  clearCrossAssistCache,
  anyCrossVolleyBuffered,
  isCrossVolleyArmed,
  tickBufferedCrossVolleys,
} from '../systems/crossAssist'
import { bootstrapReceiveRoutes } from '../systems/receiveRoutes'
import { getUserTeam, useGameStore } from '../store/gameStore'
import { playerRegistry } from '../systems/entityRegistry'
import { clearDribbleState } from '../systems/ballDribble'
import { applyBallVelocity, ensureBallDynamic, kickBall } from '../systems/ballPhysics'
import { applyMarkerPressureToKick } from '../systems/markerPressure'
import { narrationSfx } from '../systems/narrationSfx'
import { crowdSfx } from '../systems/crowdSfx'
import { isFieldParadePhase } from '../systems/matchPhases'
import { replaySystem } from '../systems/replaySystem'
import { isUserPauseActive } from '../systems/gameTime'
import { sfx } from '../systems/sfx'
import { syncActivePlayerOnLooseBall } from '../systems/playerSwitch'
import { tickContactBallClaims } from '../systems/playerFootPhysics'

/**
 * Posse ativa + timeout de passe.
 * Domínio: colisão física (pés/corpo) + fallback de contato apertado.
 */
export function TeamController() {
  useFrame(() => {
    const store = useGameStore.getState()
    if (
      store.phase === 'goal' ||
      store.phase === 'goal-celebration' ||
      store.phase === 'replay' ||
      store.phase === 'half-time' ||
      store.phase === 'half-time-exit' ||
      store.phase === 'half-time-enter' ||
      store.phase === 'full-time' ||
      store.phase === 'full-time-exit' ||
      isFieldParadePhase(store.phase) ||
      store.ballFrozen
    ) {
      return
    }

    if (store.phase !== 'playing') return
    if (isUserPauseActive()) return

    const possession = store.ballPossession

    if (possession) {
      const holder = playerRegistry.get(possession.playerId)
      if (!holder) {
        store.clearPossession()
        return
      }

      if (
        possession.team === getUserTeam() &&
        holder.role !== 'gk' &&
        holder.id !== store.activePlayerId
      ) {
        store.setActivePlayer(possession.playerId)
      }

      return
    }

    syncActivePlayerOnLooseBall()

    if (anyCrossVolleyBuffered()) {
      tickBufferedCrossVolleys()
    }

    const passIntent = store.passIntent
    if (
      passIntent &&
      performance.now() - passIntent.startedAt > PASS_INTENT_TIMEOUT_MS
    ) {
      const keepCrossVolley =
        passIntent.passType === 'cross' &&
        (anyCrossVolleyBuffered() || isCrossVolleyArmed(store))
      if (!keepCrossVolley) {
        if (!store.ballPossession) {
          narrationSfx.playPassError()
        }
        clearCrossAssistCache()
        store.setPassIntent(null)
      }
    }

    // Contato pé/corpo — fallback se o evento Rapier não disparar
    tickContactBallClaims()
  })

  return null
}

export function releaseBallFromFeet(
  vx: number,
  vy: number,
  vz: number,
  passerId?: string,
  opts?: { loft?: number; releaseKind?: 'pass' | 'through' | 'cross' | 'shot' | 'setpiece' },
) {
  const store = useGameStore.getState()
  store.clearPossession()
  clearDribbleState()

  if (passerId) {
    store.blockPasserClaim(passerId, 380)
    store.setLastTouch(
      playerRegistry.get(passerId)?.team ?? getUserTeam(),
    )
  }

  ensureBallDynamic()

  const speed = Math.hypot(vx, vz)
  if (speed > 0.01) {
    sfx.playKick()
    const passer = passerId ? playerRegistry.get(passerId) : null
    let loft = opts?.loft ?? (vy > 0.5 ? vy / speed : 0)
    let dirX = vx / speed
    let dirZ = vz / speed
    let outSpeed = speed

    if (passerId && opts?.releaseKind) {
      const adjusted = applyMarkerPressureToKick(
        passerId,
        dirX,
        dirZ,
        outSpeed,
        opts.releaseKind,
        loft,
      )
      dirX = adjusted.dirX
      dirZ = adjusted.dirZ
      outSpeed = adjusted.speed
      loft = adjusted.loft
    }

    if (passer) {
      if (passer.team === getUserTeam() && opts?.releaseKind === 'shot') {
        crowdSfx.notifyHomeShot()
      }
      if (opts?.releaseKind === 'shot') {
        replaySystem.notifyShot(passer.team)
      }
      narrationSfx.notifyBallRelease(opts?.releaseKind)
    }
    kickBall({
      dirX,
      dirZ,
      speed: outSpeed,
      loft,
    })
    const intent = store.passIntent
    if (
      intent &&
      opts?.releaseKind &&
      (opts.releaseKind === 'pass' ||
        opts.releaseKind === 'through' ||
        opts.releaseKind === 'cross')
    ) {
      bootstrapReceiveRoutes(intent)
    }
  } else {
    applyBallVelocity(vx, vy, vz)
  }
}

export function passSpeedForDistance(dist: number): number {
  // Distância mínima efetiva: toques colados ainda precisam entregar
  const d = Math.max(dist, 2.2)
  // Curto chega em ~0.42–0.55s · médio ~0.9s · longo ~1.35s
  const travelT = THREE.MathUtils.clamp(0.4 + d * 0.045, 0.42, 1.38)
  const deliver = (d / travelT) * 1.12
  // Piso extra nos curtos (<6 m) pra não “morrer” no meio
  const shortBoost = d < 6 ? THREE.MathUtils.lerp(PASS_SPEED_BASE * 0.55, 0, (d - 2.2) / 3.8) : 0
  const raw = deliver + PASS_SPEED_BASE * 0.14 + shortBoost
  return THREE.MathUtils.clamp(raw, PASS_SPEED_MIN, PASS_SPEED_MAX)
}

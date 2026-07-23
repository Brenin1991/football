import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { PLAYER_HEIGHT } from '../constants'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { ballRef, playerRegistry } from '../systems/entityRegistry'
import { updateCameraBasis } from '../systems/cameraState'
import { getIntroCameraState, getIntroFadeOpacity, getIntroFov } from '../systems/introCamera'
import { entranceSystem } from '../systems/teamEntrance'
import { clearIntroFade, setIntroFadeOpacity } from '../systems/screenTransition'
import { replaySystem } from '../systems/replaySystem'
import { computeBroadcastCamera } from '../systems/broadcastCamera'
import { isAttackingFreeKickPresentation } from '../systems/setPiece'
import { buildPlayerOrbitCamera, tickCameraLook } from '../systems/cameraLook'

import { FIELD_SCALE } from '../systems/fieldData'

const TRACK_Z = 0.22
const TRACK_FOCUS_X = 0.26

const CORNER_CAM_BEHIND = 3.1
const CORNER_CAM_HEIGHT = 2.45
const CORNER_LOOK_AHEAD = 5.5
/** Falta ofensiva — câmera baixa estilo PES (ombro) */
const FREE_KICK_CAM_BEHIND = 2.85
const FREE_KICK_CAM_HEIGHT = 0.88
const FREE_KICK_LOOK_AHEAD = 12
const FREE_KICK_FOV = 42
const REPLAY_FOV = 36

/**
 * Modo Pro — chase cam estilo Be a Pro:
 * um pouco alta e afastada, yaw atrasado (não gira 1:1 com o jogador).
 */
const PRO_CAM_BEHIND = 4.15
const PRO_CAM_HEIGHT = 2.72
const PRO_CAM_LOOK_AHEAD = 0.2
const PRO_CAM_LOOK_Y = 1.85
const PRO_FOV = 60
/** Quão rápido o orbit segue o jogador (baixo = menos roda) */
const PRO_YAW_FOLLOW = 1.15
const PRO_POS_FOLLOW = 2.2
const PRO_LOOK_FOLLOW = 3.5

function lerpAngle(from: number, to: number, t: number) {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d * t
}

export function GameCamera() {
  const { camera } = useThree()
  const focus = useRef(new THREE.Vector3(0, 0.5, 0))
  const desired = useRef(new THREE.Vector3(-8.2 * FIELD_SCALE, 3.8 * Math.sqrt(FIELD_SCALE), 0))
  const lookAt = useRef(new THREE.Vector3(0, 0.5, 0))
  const desiredLookAt = useRef(new THREE.Vector3(0, 0.5, 0))
  const broadcastTarget = useRef({
    position: new THREE.Vector3(),
    lookAt: new THREE.Vector3(),
    fov: 44,
  })
  const camDir = useRef(new THREE.Vector3())
  const cornerDesired = useRef(new THREE.Vector3())
  const cornerLookAt = useRef(new THREE.Vector3())
  const introDesired = useRef(new THREE.Vector3())
  const introLookAt = useRef(new THREE.Vector3())
  const replayPos = useRef(new THREE.Vector3())
  const replayLook = useRef(new THREE.Vector3())
  const proYaw = useRef<number | null>(null)
  const proReady = useRef(false)

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    const camLook = tickCameraLook(delta)

    if (store.phase === 'intro') {
      const bounds = store.fieldBounds
      const elapsed = entranceSystem.getElapsed()
      if (bounds) {
        getIntroCameraState(
          elapsed,
          bounds,
          entranceSystem.getProgress(),
          introDesired.current,
          introLookAt.current,
        )
      }

      const fade = getIntroFadeOpacity(elapsed)
      setIntroFadeOpacity(fade)

      // Intro sempre snap — lerp fazia a câmera “subir” e perder os jogadores
      camera.position.copy(introDesired.current)
      lookAt.current.copy(introLookAt.current)
      camera.lookAt(lookAt.current)
      if (camera instanceof THREE.PerspectiveCamera) {
        const targetFov = getIntroFov(elapsed)
        if (Math.abs(camera.fov - targetFov) > 0.05) {
          camera.fov = targetFov
          camera.updateProjectionMatrix()
        }
      }
      camera.getWorldDirection(camDir.current)
      updateCameraBasis(camDir.current.x, camDir.current.z)
      return
    }

    clearIntroFade()

    if (store.phase === 'replay') {
      replaySystem.getCameraState(delta, replayPos.current, replayLook.current)
      const dist = camera.position.distanceTo(replayPos.current)
      // Posição suave; lookAt na bola bem preso
      const posT = dist > 14 ? 1 : 1 - Math.exp(-3.8 * delta)
      const lookT = dist > 14 ? 1 : 1 - Math.exp(-8.5 * delta)
      camera.position.lerp(replayPos.current, posT)
      lookAt.current.lerp(replayLook.current, lookT)
      camera.lookAt(lookAt.current)
      if (camera instanceof THREE.PerspectiveCamera) {
        const fovT = 1 - Math.exp(-6 * delta)
        camera.fov = THREE.MathUtils.lerp(camera.fov, REPLAY_FOV, fovT)
        camera.updateProjectionMatrix()
      }
      camera.getWorldDirection(camDir.current)
      updateCameraBasis(camDir.current.x, camDir.current.z)
      return
    }

    if (store.phase === 'goal-celebration') {
      const { fov, hardCut } = replaySystem.getCelebrationCameraState(
        cornerDesired.current,
        cornerLookAt.current,
      )
      if (hardCut) {
        camera.position.copy(cornerDesired.current)
        lookAt.current.copy(cornerLookAt.current)
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = fov
          camera.updateProjectionMatrix()
        }
      } else {
        // Tracking firme no rosto — sem atraso que “perde” o enquadramento
        const t = 1 - Math.exp(-9.5 * delta)
        camera.position.lerp(cornerDesired.current, t)
        lookAt.current.lerp(cornerLookAt.current, t)
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 1 - Math.exp(-10 * delta))
          camera.updateProjectionMatrix()
        }
      }
      camera.lookAt(lookAt.current)
      camera.getWorldDirection(camDir.current)
      updateCameraBasis(camDir.current.x, camDir.current.z)
      return
    }

    const kicker =
      store.setPieceKickerId != null
        ? playerRegistry.get(store.setPieceKickerId)
        : undefined

    const attackingFk =
      isAttackingFreeKickPresentation(
        store.phase,
        store.setPieceTeam,
        store.setPiecePosition,
        store.fieldBounds,
      )

    const userSetPieceThirdPerson =
      (store.phase === 'corner' ||
        store.phase === 'penalty' ||
        attackingFk) &&
      store.ballFrozen &&
      store.setPieceTeam === getUserTeam() &&
      !store.setPieceKickPending &&
      kicker != null &&
      store.setPiecePosition != null

    if (userSetPieceThirdPerson) {
      const aim = store.setPieceAimAngle
      const fx = Math.sin(aim)
      const fz = Math.cos(aim)
      const kx = kicker.position.x
      const kz = kicker.position.z
      const behind = attackingFk ? FREE_KICK_CAM_BEHIND : CORNER_CAM_BEHIND
      const height = attackingFk ? FREE_KICK_CAM_HEIGHT : CORNER_CAM_HEIGHT
      const lookAhead = attackingFk ? FREE_KICK_LOOK_AHEAD : CORNER_LOOK_AHEAD
      // Mira fixa no gol — contato na bola NÃO mexe a câmera
      const lookY = attackingFk ? 0.62 : PLAYER_HEIGHT * 0.55

      cornerDesired.current.set(
        kx - fx * behind,
        height,
        kz - fz * behind,
      )
      const ball = store.setPiecePosition!
      cornerLookAt.current.set(
        ball.x + fx * lookAhead,
        lookY,
        ball.z + fz * lookAhead,
      )

      // Falta: câmera travada na mira — contato na bola não mexe nada aqui
      const settle = attackingFk ? 4.2 : 7
      const t = 1 - Math.exp(-settle * delta)
      camera.position.lerp(cornerDesired.current, t)
      lookAt.current.lerp(cornerLookAt.current, t)
      camera.lookAt(lookAt.current)
      if (attackingFk && camera instanceof THREE.PerspectiveCamera) {
        camera.fov = THREE.MathUtils.lerp(
          camera.fov,
          FREE_KICK_FOV,
          1 - Math.exp(-5 * delta),
        )
        camera.updateProjectionMatrix()
      }
      // Basis só da mira (stick esquerdo) — não do contato
      updateCameraBasis(fx, fz)
      return
    }

    // Modo Pro: chase cam com yaw atrasado (evita rodar com cada giro do jogador)
    if (
      store.controlMode === 'pro' &&
      (store.phase === 'playing' ||
        store.phase === 'kickoff' ||
        store.phase === 'corner' ||
        store.phase === 'free-kick' ||
        store.phase === 'penalty' ||
        store.phase === 'throw-in')
    ) {
      const pro =
        playerRegistry.get(store.activePlayerId) ??
        playerRegistry.get(`${getUserTeam()}-${store.proSlotIndex}`)
      if (pro) {
        const px = pro.position.x
        const pz = pro.position.z
        const ball = ballRef.current
        const spd = Math.hypot(pro.velocity.x, pro.velocity.z)
        const hasBall = store.ballPossession?.playerId === pro.id
        const lookingAround = camLook.holding || camLook.active

        const toBallX = ball.x - px
        const toBallZ = ball.z - pz
        const ballDist = Math.hypot(toBallX, toBallZ)
        const ballYaw =
          ballDist > 0.15 ? Math.atan2(toBallX, toBallZ) : pro.rotation

        // Com bola: chase no movimento/facing. Sem bola: orbit sempre mira a bola.
        // Enquanto look no stick: congela o yaw base (órbita limpa em torno do cara).
        let targetYaw = pro.rotation
        if (!lookingAround) {
          if (!hasBall) {
            targetYaw = ballYaw
          } else if (spd > 1.1) {
            targetYaw = Math.atan2(pro.velocity.x, pro.velocity.z)
          }
        }

        if (proYaw.current == null || !proReady.current) {
          proYaw.current = targetYaw
          proReady.current = true
        } else if (!lookingAround) {
          const yawFollow = hasBall ? PRO_YAW_FOLLOW : PRO_YAW_FOLLOW * 1.35
          const yawT = 1 - Math.exp(-yawFollow * delta)
          proYaw.current = lerpAngle(proYaw.current, targetYaw, yawT)
        }

        const yaw = proYaw.current
        const pivotY = PLAYER_HEIGHT * 0.72

        if (lookingAround) {
          // Órbita em torno do jogador — lookAt nele, esquece a bola
          buildPlayerOrbitCamera(
            px,
            pivotY,
            pz,
            yaw,
            camLook.yaw,
            camLook.pitch,
            PRO_CAM_BEHIND,
            PRO_CAM_HEIGHT,
            cornerDesired.current,
            cornerLookAt.current,
          )
        } else {
          const fx = Math.sin(yaw)
          const fz = Math.cos(yaw)

          cornerDesired.current.set(
            px - fx * PRO_CAM_BEHIND,
            PRO_CAM_HEIGHT,
            pz - fz * PRO_CAM_BEHIND,
          )

          if (!hasBall) {
            const lookY = Math.max(PRO_CAM_LOOK_Y, ball.y * 0.35 + 0.35)
            cornerLookAt.current.set(ball.x, lookY, ball.z)
          } else {
            const ballPull =
              ballDist > 1.2 ? Math.min(0.22, (ballDist - 1.2) / 28) : 0
            const bx = ballDist > 0.01 ? toBallX / ballDist : fx
            const bz = ballDist > 0.01 ? toBallZ / ballDist : fz
            const lookFx = fx * (1 - ballPull) + bx * ballPull
            const lookFz = fz * (1 - ballPull) + bz * ballPull
            const lookLen = Math.hypot(lookFx, lookFz) || 1
            cornerLookAt.current.set(
              px + (lookFx / lookLen) * PRO_CAM_LOOK_AHEAD,
              PRO_CAM_LOOK_Y,
              pz + (lookFz / lookLen) * PRO_CAM_LOOK_AHEAD,
            )
          }
        }

        const posFollow = lookingAround ? 9.5 : store.ballFrozen ? 3.2 : PRO_POS_FOLLOW
        const lookFollow = lookingAround
          ? 11
          : hasBall
            ? PRO_LOOK_FOLLOW
            : PRO_LOOK_FOLLOW * 1.25
        const posT = 1 - Math.exp(-posFollow * delta)
        const lookT = 1 - Math.exp(-lookFollow * delta)
        camera.position.lerp(cornerDesired.current, posT)
        lookAt.current.lerp(cornerLookAt.current, lookT)
        camera.lookAt(lookAt.current)

        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = THREE.MathUtils.lerp(
            camera.fov,
            PRO_FOV,
            1 - Math.exp(-4.5 * delta),
          )
          camera.updateProjectionMatrix()
        }
        camera.getWorldDirection(camDir.current)
        updateCameraBasis(camDir.current.x, camDir.current.z)
        return
      }
    } else {
      proReady.current = false
      proYaw.current = null
    }

    focus.current.x = THREE.MathUtils.lerp(focus.current.x, ballRef.current.x, TRACK_FOCUS_X)
    focus.current.z = THREE.MathUtils.lerp(focus.current.z, ballRef.current.z, TRACK_Z)

    const lookingAround = camLook.holding || camLook.active
    const active =
      playerRegistry.get(store.activePlayerId) ??
      playerRegistry.get(`${getUserTeam()}-0`)

    if (lookingAround && active) {
      // Time mode: órbita no jogador ativo — esquece a bola
      const baseYaw =
        Math.hypot(active.velocity.x, active.velocity.z) > 0.8
          ? Math.atan2(active.velocity.x, active.velocity.z)
          : active.rotation
      buildPlayerOrbitCamera(
        active.position.x,
        PLAYER_HEIGHT * 0.72,
        active.position.z,
        baseYaw,
        camLook.yaw,
        camLook.pitch,
        5.4,
        2.15,
        desired.current,
        desiredLookAt.current,
      )
      const t = 1 - Math.exp(-10 * delta)
      camera.position.lerp(desired.current, t)
      lookAt.current.lerp(desiredLookAt.current, t)
      camera.lookAt(lookAt.current)
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, 40, 1 - Math.exp(-6 * delta))
        camera.updateProjectionMatrix()
      }
      camera.getWorldDirection(camDir.current)
      updateCameraBasis(camDir.current.x, camDir.current.z)
      return
    }

    computeBroadcastCamera(
      focus.current.x,
      focus.current.z,
      store.fieldBounds,
      broadcastTarget.current,
      store.broadcastCameraPreset,
    )
    desired.current.copy(broadcastTarget.current.position)
    desiredLookAt.current.copy(broadcastTarget.current.lookAt)

    const returnSpeed = store.setPieceKickPending ? 9 : 4.8
    const t = 1 - Math.exp(-returnSpeed * delta)
    camera.position.lerp(desired.current, t)
    lookAt.current.lerp(desiredLookAt.current, t)
    camera.lookAt(lookAt.current)

    if (camera instanceof THREE.PerspectiveCamera) {
      const fovT = 1 - Math.exp(-7.5 * delta)
      camera.fov = THREE.MathUtils.lerp(camera.fov, broadcastTarget.current.fov, fovT)
      camera.updateProjectionMatrix()
    }

    camera.getWorldDirection(camDir.current)
    updateCameraBasis(camDir.current.x, camDir.current.z)
  })

  return null
}

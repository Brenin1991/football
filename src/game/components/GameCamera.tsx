import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { PLAYER_HEIGHT } from '../constants'
import { useGameStore, USER_TEAM } from '../store/gameStore'
import { ballRef, playerRegistry } from '../systems/entityRegistry'
import { updateCameraBasis } from '../systems/cameraState'
import { getIntroCameraState, getIntroFadeOpacity } from '../systems/introCamera'
import { entranceSystem } from '../systems/teamEntrance'
import { clearIntroFade, setIntroFadeOpacity } from '../systems/screenTransition'
import { replaySystem } from '../systems/replaySystem'
import { computeBroadcastCamera } from '../systems/broadcastCamera'

import { FIELD_SCALE } from '../systems/fieldData'

const TRACK_Z = 0.22
const TRACK_FOCUS_X = 0.26

const CORNER_CAM_BEHIND = 3.1
const CORNER_CAM_HEIGHT = 2.45
const CORNER_LOOK_AHEAD = 5.5

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

  useFrame((_, delta) => {
    const store = useGameStore.getState()

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

      const snap = fade > 0.82
      const t = snap ? 1 : 1 - Math.exp(-4.2 * delta)
      camera.position.lerp(introDesired.current, t)
      lookAt.current.lerp(introLookAt.current, t)
      camera.lookAt(lookAt.current)
      camera.getWorldDirection(camDir.current)
      updateCameraBasis(camDir.current.x, camDir.current.z)
      return
    }

    clearIntroFade()

    if (store.phase === 'replay') {
      replaySystem.getCameraState(delta, replayPos.current, replayLook.current)
      const t = 1 - Math.exp(-6 * delta)
      camera.position.lerp(replayPos.current, t)
      lookAt.current.lerp(replayLook.current, t)
      camera.lookAt(lookAt.current)
      camera.getWorldDirection(camDir.current)
      updateCameraBasis(camDir.current.x, camDir.current.z)
      return
    }

    if (store.phase === 'goal-celebration') {
      const ball = ballRef.current
      const bounds = store.fieldBounds
      const cx = bounds?.center.x ?? 0
      cornerDesired.current.set(
        cx - 7.5 * FIELD_SCALE,
        3.4 * Math.sqrt(FIELD_SCALE),
        ball.z + 2.2,
      )
      cornerLookAt.current.set(ball.x, 0.65, ball.z)
      const t = 1 - Math.exp(-4.5 * delta)
      camera.position.lerp(cornerDesired.current, t)
      lookAt.current.lerp(cornerLookAt.current, t)
      camera.lookAt(lookAt.current)
      camera.getWorldDirection(camDir.current)
      updateCameraBasis(camDir.current.x, camDir.current.z)
      return
    }

    const kicker =
      store.setPieceKickerId != null
        ? playerRegistry.get(store.setPieceKickerId)
        : undefined

    const userSetPieceThirdPerson =
      (store.phase === 'corner' || store.phase === 'penalty') &&
      store.ballFrozen &&
      store.setPieceTeam === USER_TEAM &&
      !store.setPieceKickPending &&
      kicker != null &&
      store.setPiecePosition != null

    if (userSetPieceThirdPerson) {
      const aim = store.setPieceAimAngle
      const fx = Math.sin(aim)
      const fz = Math.cos(aim)
      const kx = kicker.position.x
      const kz = kicker.position.z

      cornerDesired.current.set(
        kx - fx * CORNER_CAM_BEHIND,
        CORNER_CAM_HEIGHT,
        kz - fz * CORNER_CAM_BEHIND,
      )
      const ball = store.setPiecePosition!
      cornerLookAt.current.set(
        ball.x + fx * CORNER_LOOK_AHEAD,
        PLAYER_HEIGHT * 0.55,
        ball.z + fz * CORNER_LOOK_AHEAD,
      )

      const t = 1 - Math.exp(-7 * delta)
      camera.position.lerp(cornerDesired.current, t)
      lookAt.current.lerp(cornerLookAt.current, t)
      camera.lookAt(lookAt.current)
      updateCameraBasis(fx, fz)
      return
    }

    focus.current.x = THREE.MathUtils.lerp(focus.current.x, ballRef.current.x, TRACK_FOCUS_X)
    focus.current.z = THREE.MathUtils.lerp(focus.current.z, ballRef.current.z, TRACK_Z)

    computeBroadcastCamera(
      focus.current.x,
      focus.current.z,
      store.fieldBounds,
      broadcastTarget.current,
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

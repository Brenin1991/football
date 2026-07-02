import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import {
  GOAL_CELEBRATION_TIME,
  REAL_SECONDS_PER_GAME_MINUTE,
} from '../constants'
import { useGameStore } from '../store/gameStore'
import { ballRef, setBallPosition } from '../systems/entityRegistry'
import { ensureBallKinematic } from '../systems/ballPhysics'
import { ballRestY } from '../systems/fieldData'
import {
  detectOutOfBounds,
  determineSetPieceTeam,
  getKickoffPosition,
  isBallInGoal,
  resolveCorner,
  resolveGoalKick,
  resolveThrowIn,
} from '../systems/rules'
import { beginSetPiece, executeSetPieceKick, isActiveSetPiecePhase, isKickerReadyForSetPiece, pickSetPieceKicker, initAiSetPieceAim } from '../systems/setPiece'
import { setupKickoff } from '../systems/kickoff'
import { isScreenTransitionActive, runScreenTransition } from '../systems/screenTransition'
import { USER_TEAM } from '../store/gameStore'
import { getAiSetPieceKickDelay } from './GameInput'
import { crowdSfx } from '../systems/crowdSfx'
import { narrationSfx } from '../systems/narrationSfx'
import { getSimDelta } from '../systems/gameTime'
import { isReplaySequenceRunning, replaySystem } from '../systems/replaySystem'

const KICKOFF_GRACE = 3
const MIN_PLAY_TIME_BEFORE_OOB = 0.6

export function MatchManager() {
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const goalZones = useGameStore((s) => s.goalZones)
  const lastTouchTeam = useGameStore((s) => s.lastTouchTeam)
  const timerRef = useRef(0)
  const playingSinceRef = useRef(0)
  const graceRef = useRef(KICKOFF_GRACE)
  const setPieceTimerRef = useRef(0)
  const transitionBusyRef = useRef(false)

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    if (!fieldBounds) return
    if (store.phase === 'intro') return
    if (
      store.phase === 'half-time-exit' ||
      store.phase === 'half-time-enter' ||
      store.phase === 'full-time-exit'
    ) {
      return
    }

    const simDelta = getSimDelta(delta)
    timerRef.current += simDelta

    if (store.phase === 'playing') {
      playingSinceRef.current += simDelta
      store.tickMatchTime(simDelta * REAL_SECONDS_PER_GAME_MINUTE)
      graceRef.current = Math.max(0, graceRef.current - simDelta)
    }

    if (store.phase === 'playing' && !store.ballFrozen && !isScreenTransitionActive() && !isReplaySequenceRunning()) {
      const ball = ballRef.current
      const canCheckOob =
        playingSinceRef.current >= MIN_PLAY_TIME_BEFORE_OOB && graceRef.current <= 0

      if (canCheckOob) {
        const goalTeam = isBallInGoal(ball, goalZones)
        if (goalTeam) {
          ensureBallKinematic()
          setBallPosition({ x: ball.x, y: ballRestY(), z: ball.z })
          replaySystem.requestGoalSequence(goalTeam, () => {
            useGameStore.getState().scoreGoal(goalTeam)
            timerRef.current = 0
            playingSinceRef.current = 0
          })
          return
        }

        let out = detectOutOfBounds(ball, fieldBounds)
        const fellPastPitch = ball.y < fieldBounds.center.y - 1.2

        if (!out.out && fellPastPitch) {
          out = detectOutOfBounds(
            { x: ball.x, y: ballRestY(), z: ball.z },
            fieldBounds,
          )
        }

        if (out.out && out.type && out.side && !transitionBusyRef.current) {
          if (store.passIntent) {
            narrationSfx.playPassError()
          }

          const { phase: setPhase, team } = determineSetPieceTeam(
            out.type,
            lastTouchTeam,
            out.side,
          )

          let position = { x: ball.x, y: ballRestY(), z: ball.z }
          let message = ''

          if (setPhase === 'throw-in') {
            position = resolveThrowIn(ball, fieldBounds)
            message =
              team === USER_TEAM
                ? `Lateral — ← → mirar · Espaço chutar`
                : `Lateral — Visitante`
          } else if (setPhase === 'corner') {
            position = resolveCorner(ball, fieldBounds, team)
            message =
              team === USER_TEAM
                ? `Escanteio — ← → mirar · Espaço chutar`
                : `Escanteio — Visitante`
          } else {
            position = resolveGoalKick(fieldBounds, team)
            if (lastTouchTeam === USER_TEAM && team !== USER_TEAM) {
              crowdSfx.notifyHomeMiss()
            }
            if (lastTouchTeam && lastTouchTeam !== team) {
              narrationSfx.playKickError()
            }
            message =
              team === USER_TEAM
                ? `Tiro de meta — ← → mirar · Espaço chutar`
                : `Tiro de meta — Visitante`
          }

          position.y = ballRestY()
          transitionBusyRef.current = true
          ensureBallKinematic()
          setBallPosition({ x: ball.x, y: ballRestY(), z: ball.z })

          const startSetPiece = () => {
            void runScreenTransition(() => {
              setBallPosition(position)
              beginSetPiece(setPhase, team, position, message)
              setPieceTimerRef.current = 0
              timerRef.current = 0
              playingSinceRef.current = 0
            }).finally(() => {
              transitionBusyRef.current = false
            })
          }

          if (replaySystem.tryRunShotOutReplay(startSetPiece)) {
            return
          }
          startSetPiece()
        } else if (fellPastPitch && !out.out) {
          ensureBallKinematic()
          setBallPosition({ x: ball.x, y: ballRestY(), z: ball.z })
        }
      }
    }

    const isSetPiece = isActiveSetPiecePhase(store.phase)

    if (isSetPiece && store.ballFrozen && store.setPieceTeam) {
      if (!store.setPieceKickerId && store.setPiecePosition) {
        const kickerId = pickSetPieceKicker(
          store.setPieceTeam,
          store.setPiecePosition,
          store.phase,
        )
        if (kickerId) {
          useGameStore.setState({ setPieceKickerId: kickerId })
        }
      }

      setPieceTimerRef.current += simDelta
      const kickDelay = getAiSetPieceKickDelay(store.phase)
      const kickerReady =
        store.setPieceKickerId &&
        store.setPiecePosition &&
        store.fieldBounds &&
        isKickerReadyForSetPiece(
          store.setPieceKickerId,
          store.setPiecePosition,
          store.phase,
          store.fieldBounds,
          store.setPieceAimAngle,
        )
      const autoKickAway =
        store.setPieceTeam !== USER_TEAM &&
        kickerReady &&
        setPieceTimerRef.current >= kickDelay

      if (autoKickAway) {
        if (store.fieldBounds && store.setPiecePosition && store.setPieceTeam) {
          const aim = initAiSetPieceAim(
            store.phase,
            store.setPieceTeam,
            store.setPiecePosition,
            store.fieldBounds,
          )
          useGameStore.getState().setSetPieceAim(aim)
        }
        executeSetPieceKick()
        setPieceTimerRef.current = 0
        playingSinceRef.current = 0
        graceRef.current = KICKOFF_GRACE
      }
    } else {
      setPieceTimerRef.current = 0
    }

    if (
      store.phase === 'goal' &&
      timerRef.current >= GOAL_CELEBRATION_TIME &&
      !transitionBusyRef.current
    ) {
      const center = getKickoffPosition(fieldBounds.center)
      center.y = ballRestY()
      transitionBusyRef.current = true
      void runScreenTransition(() => {
        setupKickoff(store.kickoffTeam, center)
        setBallPosition(center)
        graceRef.current = KICKOFF_GRACE
        timerRef.current = 0
      }).finally(() => {
        transitionBusyRef.current = false
      })
    }
  })

  return null
}

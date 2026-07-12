import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import {
  BALL_OUT_SETTLE_SEC,
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
import { getUserTeam } from '../store/gameStore'
import { getAiSetPieceKickDelay } from './GameInput'
import { crowdSfx } from '../systems/crowdSfx'
import { narrationSfx } from '../systems/narrationSfx'
import { sfx } from '../systems/sfx'
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
  const pendingOobRef = useRef<{
    crossBall: { x: number; y: number; z: number }
    type: 'sideline' | 'goal-line'
    side: 'left' | 'right' | 'home' | 'away'
    timer: number
  } | null>(null)

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

    if (store.phase !== 'playing') {
      pendingOobRef.current = null
    }

    if (store.phase === 'playing' && !store.ballFrozen && !isScreenTransitionActive() && !isReplaySequenceRunning()) {
      const ball = ballRef.current
      const canCheckOob =
        playingSinceRef.current >= MIN_PLAY_TIME_BEFORE_OOB && graceRef.current <= 0

      if (canCheckOob) {
        const goalTeam = isBallInGoal(ball, goalZones)
        if (goalTeam) {
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
          if (!pendingOobRef.current) {
            if (store.passIntent) {
              narrationSfx.playPassError()
            }
            pendingOobRef.current = {
              crossBall: { x: ball.x, y: ballRestY(), z: ball.z },
              type: out.type,
              side: out.side,
              timer: 0,
            }
          }

          pendingOobRef.current.timer += simDelta
          if (pendingOobRef.current.timer < BALL_OUT_SETTLE_SEC) {
            return
          }

          const crossBall = pendingOobRef.current.crossBall
          const oobType = pendingOobRef.current.type
          const oobSide = pendingOobRef.current.side
          pendingOobRef.current = null

          sfx.playWhistle()

          const { phase: setPhase, team } = determineSetPieceTeam(
            oobType,
            lastTouchTeam,
            oobSide,
          )

          let position = { x: crossBall.x, y: ballRestY(), z: crossBall.z }
          let message = ''

          if (setPhase === 'throw-in') {
            position = resolveThrowIn(crossBall, fieldBounds)
            message =
              team === getUserTeam()
                ? `Lateral — ← → mirar · Espaço chutar`
                : `Lateral — Visitante`
          } else if (setPhase === 'corner') {
            position = resolveCorner(crossBall, fieldBounds, team)
            message =
              team === getUserTeam()
                ? `Escanteio — ← → mirar · Espaço chutar`
                : `Escanteio — Visitante`
          } else {
            position = resolveGoalKick(fieldBounds, team)
            if (lastTouchTeam === getUserTeam() && team !== getUserTeam()) {
              crowdSfx.notifyHomeMiss()
            }
            if (lastTouchTeam && lastTouchTeam !== team) {
              narrationSfx.playKickError()
            }
            message =
              team === getUserTeam()
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
        } else {
          pendingOobRef.current = null
          if (fellPastPitch && !out.out) {
            ensureBallKinematic()
            setBallPosition({ x: ball.x, y: ballRestY(), z: ball.z })
          }
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
        store.setPieceTeam !== getUserTeam() &&
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

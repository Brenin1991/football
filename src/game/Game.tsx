import { Suspense, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { Ball } from './components/Ball'
import { BallPhysicsDriver } from './components/BallPhysicsDriver'
import { ActivePlayerMarker } from './components/ActivePlayerMarker'
import { BallCallBubble } from './components/BallCallBubble'
import { Field } from './components/Field'
import { FloodlightXShadows } from './components/FloodlightXShadows'
import { GameCamera } from './components/GameCamera'
import { GameInput } from './components/GameInput'
import { GraphicsPipeline } from './components/graphics/GraphicsPipeline'
import { HUD } from './components/HUD'
import { MarkerCacheUpdater } from './components/MarkerCacheUpdater'
import { ScreenFade } from './components/ScreenFade'
import { MatchManager } from './components/MatchManager'
import { CrowdManager } from './components/CrowdManager'
import { NarrationManager } from './components/NarrationManager'
import { Player } from './components/Player'
import { Referee } from './components/Referee'
import { RefereeManager } from './components/RefereeManager'
import { ReplayManager } from './components/ReplayManager'
import { IntroBroadcastOverlay } from './components/IntroBroadcastOverlay'
import { ReplayOverlay } from './components/ReplayOverlay'
import { CinematicSkipHint } from './components/CinematicSkipHint'
import { ReplayRecorder } from './components/ReplayRecorder'
import { SetPieceAim } from './components/SetPieceAim'
import { OffsideReplayLine } from './components/OffsideReplayLine'
import { StrikeAimIndicator } from './components/StrikeAimIndicator'
import { TeamEntranceManager } from './components/TeamEntranceManager'
import { TeamController } from './components/TeamController'
import { GoalkeeperController } from './components/GoalkeeperController'
import { PhysicsDebug } from './components/PhysicsDebug'
import { PhysicsWorld } from './components/PhysicsWorld'
import { GameTimeController } from './components/GameTimeController'
import { PLAYERS_PER_TEAM, playerId } from './constants'
import { PlayerAssetsProvider } from './context/PlayerAssetsContext'
import { useKeyboardControls } from './hooks/useKeyboardControls'
import { getUserTeam, useGameStore } from './store/gameStore'
import { configureGraphicsRenderer, configureGraphicsScene } from './graphics/configureGraphicsRenderer'
import { AAA_CLASSIC, getAaaCanvasDpr } from './graphics/aaaSettings'
import { PSX_CLASSIC } from './psx/psxSettings'
import { useGraphicsStore } from '../store/graphicsStore'
import { useMatchSetupStore } from '../store/matchSetupStore'
import { getFormationSpawn } from './systems/teamField'
import { getTeamFormationSlots } from './systems/teamTactics'
import { PauseMenu } from './components/PauseMenu'
import { FIELD_SCALE } from './systems/fieldData'
import { sfx } from './systems/sfx'
import { narrationSfx } from './systems/narrationSfx'
import { resetAiTacticsAdapt } from './systems/aiTacticsAdapt'
import type { TeamId } from './types'

function Loading() {
  return (
    <mesh position={[0, 40, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#333" wireframe flatShading />
    </mesh>
  )
}

type SceneProps = ReturnType<typeof useKeyboardControls>

function TeamPlayers({
  team,
  controls,
  consumeAction,
  consumePassPress,
}: {
  team: TeamId
  controls?: SceneProps['controls']
  consumeAction?: SceneProps['consumeAction']
  consumePassPress?: SceneProps['consumePassPress']
}) {
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const half = useGameStore((s) => s.half)
  const userTeam = useGameStore((s) => s.userTeam)
  // Re-render quando formação/táticas mudam ao vivo no pause
  useGameStore((s) => s.tacticsRevision)
  const isUserTeam = team === userTeam
  if (!fieldBounds) return null

  return (
    <>
      {getTeamFormationSlots(team)
        .slice(0, PLAYERS_PER_TEAM)
        .map((slot, i) => {
        const spawn = getFormationSpawn(team, slot, fieldBounds)
        return (
          <Player
            key={`${playerId(team, i)}-h${half}`}
            id={playerId(team, i)}
            team={team}
            role={slot.role}
            formation={slot}
            spawn={{ x: spawn.x, y: spawn.y, z: spawn.z }}
            controls={isUserTeam ? controls : undefined}
            consumeAction={isUserTeam ? consumeAction : undefined}
            consumePassPress={isUserTeam ? consumePassPress : undefined}
          />
        )
      })}
    </>
  )
}

function Players(props: SceneProps) {
  return (
    <>
      <TeamPlayers
        team="home"
        controls={props.controls}
        consumeAction={props.consumeAction}
        consumePassPress={props.consumePassPress}
      />
      <TeamPlayers
        team="away"
        controls={props.controls}
        consumeAction={props.consumeAction}
        consumePassPress={props.consumePassPress}
      />
    </>
  )
}

function Scene(props: SceneProps) {
  return (
    <>
      <GraphicsPipeline />

      <GameInput
        controls={props.controls}
        consumeKickRelease={props.consumeKickRelease}
        consumeSkipPress={props.consumeSkipPress}
        clearSkipPress={props.clearSkipPress}
        clearStickyActionEdges={props.clearStickyActionEdges}
      />

      <PhysicsWorld>
        <BallPhysicsDriver />
        <MarkerCacheUpdater />
        <Suspense fallback={<Loading />}>
          <Field />
          <FloodlightXShadows />
          <PhysicsDebug />
          <PlayerAssetsProvider>
            <Ball />
            <SetPieceAim />
            <StrikeAimIndicator />
            <ActivePlayerMarker />
            <BallCallBubble />
            <OffsideReplayLine />
            <Referee />
            <Players {...props} />
          </PlayerAssetsProvider>
        </Suspense>
      </PhysicsWorld>

      <TeamEntranceManager />
      <GoalkeeperController />
      <TeamController />
      <ReplayRecorder />
      <ReplayManager />
      <CrowdManager />
      <NarrationManager />
      <MatchManager />
      <RefereeManager />
      <GameCamera />
    </>
  )
}

export function Game({ onExit }: { onExit?: () => void }) {
  const keyboard = useKeyboardControls()
  const graphicsMode = useGraphicsStore((s) => s.mode)
  const aaaResolution = useGraphicsStore((s) => s.aaaResolution)
  const gfx = graphicsMode === 'aaa' ? AAA_CLASSIC : PSX_CLASSIC
  const canvasDpr: [number, number] =
    graphicsMode === 'aaa'
      ? getAaaCanvasDpr(aaaResolution)
      : [PSX_CLASSIC.renderer.dprMin, PSX_CLASSIC.renderer.dprMax]
  const setUserTeam = useGameStore((s) => s.setUserTeam)
  const setDifficulty = useGameStore((s) => s.setDifficulty)
  const setControlMode = useGameStore((s) => s.setControlMode)

  useEffect(() => {
    const session = useMatchSetupStore.getState().session
    if (session?.playerSide && session.playerSide !== getUserTeam()) {
      setUserTeam(session.playerSide)
    }
    if (session?.difficulty) {
      setDifficulty(session.difficulty)
    }
    if (session?.controlMode) {
      setControlMode(session.controlMode, session.proSlotIndex)
    }
    resetAiTacticsAdapt()
  }, [setControlMode, setDifficulty, setUserTeam])

  return (
    <div
      className="game-container"
      onPointerDown={(e) => {
        sfx.unlock()
        if (useGameStore.getState().phase === 'intro') {
          narrationSfx.playIntro()
        }
        const canvas = e.currentTarget.querySelector('canvas')
        canvas?.focus()
      }}
    >
      <div className="game-ui-layer">
        <HUD />
        <ReplayOverlay />
        <IntroBroadcastOverlay />
        <CinematicSkipHint />
        <PauseMenu
          onQuit={() => {
            onExit?.()
          }}
        />
      </div>
      <GameTimeController />
      <ScreenFade />
      <Canvas
        key={`${graphicsMode}-${aaaResolution}`}
        shadows
        tabIndex={0}
        dpr={canvasDpr}
        gl={
          graphicsMode === 'aaa'
            ? {
                antialias: AAA_CLASSIC.renderer.antialias,
                precision: AAA_CLASSIC.renderer.precision,
                powerPreference: AAA_CLASSIC.renderer.powerPreference,
                alpha: AAA_CLASSIC.renderer.alpha,
                premultipliedAlpha: AAA_CLASSIC.renderer.premultipliedAlpha,
                depth: AAA_CLASSIC.renderer.depth,
                stencil: AAA_CLASSIC.renderer.stencil,
                preserveDrawingBuffer: AAA_CLASSIC.renderer.preserveDrawingBuffer,
              }
            : {
                antialias: PSX_CLASSIC.renderer.antialias,
                powerPreference: 'high-performance',
              }
        }
        onCreated={({ gl, scene }) => {
          configureGraphicsRenderer(gl, graphicsMode)
          configureGraphicsScene(scene, graphicsMode)
          gl.domElement.focus()
          sfx.unlock()
        }}
        camera={{
          fov: 44,
          near: 0.1,
          far: 120 * FIELD_SCALE,
          position: [-8.2 * FIELD_SCALE, 3.8 * Math.sqrt(FIELD_SCALE), 0],
        }}
      >
        <fog
          attach="fog"
          args={[
            gfx.fog.color,
            gfx.fog.near * FIELD_SCALE,
            gfx.fog.far * FIELD_SCALE,
          ]}
        />
        <Scene {...keyboard} />
      </Canvas>
    </div>
  )
}

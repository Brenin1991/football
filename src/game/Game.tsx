import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Ball } from './components/Ball'
import { Field } from './components/Field'
import { GameCamera } from './components/GameCamera'
import { GameInput } from './components/GameInput'
import { PsxPipeline } from './components/graphics/PsxPipeline'
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
import { ReplayRecorder } from './components/ReplayRecorder'
import { SetPieceAim } from './components/SetPieceAim'
import { OffsideReplayLine } from './components/OffsideReplayLine'
import { TeamEntranceManager } from './components/TeamEntranceManager'
import { TeamController } from './components/TeamController'
import { GoalkeeperController } from './components/GoalkeeperController'
import { PhysicsWorld } from './components/PhysicsWorld'
import { GameTimeController } from './components/GameTimeController'
import { FORMATION_442, PLAYERS_PER_TEAM, playerId } from './constants'
import { PlayerAssetsProvider } from './context/PlayerAssetsContext'
import { useKeyboardControls } from './hooks/useKeyboardControls'
import { useGameStore } from './store/gameStore'
import { configurePsxRenderer, configurePsxScene } from './psx/configurePsxRenderer'
import { PSX_CLASSIC } from './psx/psxSettings'
import { getFormationSpawn } from './systems/teamField'
import { FIELD_SCALE } from './systems/fieldData'
import { sfx } from './systems/sfx'
import { narrationSfx } from './systems/narrationSfx'
import type { TeamId } from './types'

function Loading() {
  return (
    <mesh position={[0, 1, 0]}>
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
}: {
  team: TeamId
  controls?: SceneProps['controls']
  consumeAction?: SceneProps['consumeAction']
}) {
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const half = useGameStore((s) => s.half)
  if (!fieldBounds) return null

  return (
    <>
      {FORMATION_442.slice(0, PLAYERS_PER_TEAM).map((slot, i) => {
        const spawn = getFormationSpawn(team, slot, fieldBounds)
        return (
          <Player
            key={`${playerId(team, i)}-h${half}`}
            id={playerId(team, i)}
            team={team}
            role={slot.role}
            formation={slot}
            spawn={{ x: spawn.x, y: spawn.y, z: spawn.z }}
            controls={team === 'home' ? controls : undefined}
            consumeAction={team === 'home' ? consumeAction : undefined}
          />
        )
      })}
    </>
  )
}

function Players(props: SceneProps) {
  return (
    <>
      <TeamPlayers team="home" controls={props.controls} consumeAction={props.consumeAction} />
      <TeamPlayers team="away" />
    </>
  )
}

function Scene(props: SceneProps) {
  return (
    <>
      <PsxPipeline />

      <GameInput
        controls={props.controls}
        consumeKickRelease={props.consumeKickRelease}
      />

      <PhysicsWorld>
        <MarkerCacheUpdater />
        <Suspense fallback={<Loading />}>
          <Field />
          <PlayerAssetsProvider>
            <Ball />
            <SetPieceAim />
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

export function Game() {
  const keyboard = useKeyboardControls()

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
      <HUD />
      <GameTimeController />
      <ReplayOverlay />
      <IntroBroadcastOverlay />
      <ScreenFade />
      <Canvas
        shadows
        tabIndex={0}
        dpr={[PSX_CLASSIC.renderer.dprMin, PSX_CLASSIC.renderer.dprMax]}
        gl={{
          antialias: PSX_CLASSIC.renderer.antialias,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl, scene }) => {
          configurePsxRenderer(gl)
          configurePsxScene(scene)
          gl.domElement.focus()
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
            PSX_CLASSIC.fog.color,
            PSX_CLASSIC.fog.near * FIELD_SCALE,
            PSX_CLASSIC.fog.far * FIELD_SCALE,
          ]}
        />
        <Scene {...keyboard} />
      </Canvas>
    </div>
  )
}

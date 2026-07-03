import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { cloneShirtUv, DEFAULT_SHIRT_UV, type ShirtUvLayout } from '../../db/shirtTexture'
import {
  getTeamKitShirt,
  hasTeamKitShirtTexture,
  saveTeamKitShirtTexture,
  saveTeamKitShirtUv,
  deleteTeamKitShirtTexture,
} from '../../db/shirtTextureQueries'
import { getDatabase } from '../../db/database'
import type { TeamKit } from '../../db/types'
import { alignPlayerModelToCapsule } from '../../game/systems/animationClips'
import {
  computePlayerPreviewFrame,
  type PlayerPreviewFrame,
} from '../../game/systems/playerPreviewFrame'
import type { PlayerAppearance } from '../../game/matchRuntime'
import { applyPlayerMaterials } from '../../game/graphics/graphicsMaterials'
import {
  applyShirtTextureToModel,
  invalidateShirtTextures,
  loadShirtTextureFromDb,
} from '../../game/psx/shirtTextureApply'
import { configureGraphicsRenderer, configureGraphicsScene } from '../../game/graphics/configureGraphicsRenderer'
import { AAA_CLASSIC } from '../../game/graphics/aaaSettings'
import { PSX_CLASSIC } from '../../game/psx/psxSettings'
import { useGraphicsStore } from '../../store/graphicsStore'
import { processShirtTextureUpload } from '../../lib/processShirtTexture'

useGLTF.preload('/models/player.glb')

type TeamShirtTextureEditorProps = {
  teamId: string
  kits: TeamKit[]
  refreshKey: number
}

function kitToAppearance(kit: TeamKit | undefined): PlayerAppearance {
  const shirt = kit?.shirtColor ?? '#3b82f6'
  const shorts = kit?.shortsColor ?? '#1a1a2e'
  const socks = kit?.socksColor ?? shirt
  return {
    skinColor: '#c68663',
    kit: { shirt, shorts, socks },
  }
}

function PreviewRig({
  teamId,
  kitNumber,
  appearance,
  uv,
  textureKey,
  onFrame,
}: {
  teamId: string
  kitNumber: 1 | 2
  appearance: PlayerAppearance
  uv: ShirtUvLayout
  textureKey: number
  onFrame: (frame: PlayerPreviewFrame) => void
}) {
  const { scene } = useGLTF('/models/player.glb')
  const shirtTexRef = useRef<THREE.Texture | null>(null)
  const uvRef = useRef(uv)
  uvRef.current = uv

  const model = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group
    applyPlayerMaterials(clone, appearance, false)
    alignPlayerModelToCapsule(clone)
    return clone
  }, [scene, appearance])

  useLayoutEffect(() => {
    onFrame(computePlayerPreviewFrame(model))
  }, [model, onFrame])

  useEffect(() => {
    let cancelled = false
    shirtTexRef.current = null
    void loadShirtTextureFromDb(teamId, kitNumber).then((tex) => {
      if (cancelled) return
      shirtTexRef.current = tex
      if (tex) applyShirtTextureToModel(model, tex, uvRef.current)
    })
    return () => {
      cancelled = true
    }
  }, [model, teamId, kitNumber, textureKey])

  useLayoutEffect(() => {
    const tex = shirtTexRef.current
    if (!tex) return
    applyShirtTextureToModel(model, tex, uv)
  }, [model, uv])

  return <primitive object={model} />
}

function SceneLighting() {
  return (
    <>
      <color attach="background" args={['#1a2230']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[0, 2, 3]} intensity={1.25} />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.4} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 0]} receiveShadow={false}>
        <circleGeometry args={[0.55, 32]} />
        <meshStandardMaterial color="#243044" roughness={1} metalness={0} />
      </mesh>
    </>
  )
}

function PreviewCamera({
  frame,
  zoom,
}: {
  frame: PlayerPreviewFrame | null
  zoom: 'torso' | 'full'
}) {
  const { camera } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)

  useEffect(() => {
    if (!frame) return
    const pivot = frame.pivot.clone()
    const offset = zoom === 'torso' ? 0.55 : 1
    const camPos = frame.camera.clone().lerp(pivot, 1 - offset)

    camera.position.copy(camPos)
    if (controlsRef.current) {
      controlsRef.current.target.copy(pivot)
      controlsRef.current.minDistance = zoom === 'torso' ? 0.35 : 0.7
      controlsRef.current.maxDistance = zoom === 'torso' ? 1.4 : 2.8
      controlsRef.current.update()
    }
  }, [camera, frame, zoom])

  if (!frame) return null

  return (
    <OrbitControls
      ref={controlsRef}
      target={frame.pivot.toArray()}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI - 0.12}
    />
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <div className="kit-preview-slider">
      <div className="kit-preview-slider__head">
        <span>{label}</span>
        <output>{format ? format(value) : value.toFixed(2)}</output>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export function TeamShirtTextureEditor({ teamId, kits, refreshKey }: TeamShirtTextureEditorProps) {
  const graphicsMode = useGraphicsStore((s) => s.mode)
  const gfx = graphicsMode === 'aaa' ? AAA_CLASSIC : PSX_CLASSIC
  const [kitNumber, setKitNumber] = useState<1 | 2>(1)
  const [zoom, setZoom] = useState<'torso' | 'full'>('torso')
  const [frame, setFrame] = useState<PlayerPreviewFrame | null>(null)
  const [uv, setUv] = useState<ShirtUvLayout>(() =>
    getTeamKitShirt(getDatabase(), teamId, 1).uv,
  )
  const [savedUv, setSavedUv] = useState<ShirtUvLayout>(uv)
  const [status, setStatus] = useState<'idle' | 'saved' | 'dirty'>('idle')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [textureKey, setTextureKey] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const record = getTeamKitShirt(getDatabase(), teamId, kitNumber)
    setUv(cloneShirtUv(record.uv))
    setSavedUv(cloneShirtUv(record.uv))
    setStatus('idle')
    setUploadError(null)
  }, [teamId, kitNumber])

  const hasTexture = useMemo(() => {
    void refreshKey
    void textureKey
    try {
      return hasTeamKitShirtTexture(getDatabase(), teamId, kitNumber)
    } catch {
      return false
    }
  }, [teamId, kitNumber, refreshKey, textureKey])

  const activeKit = kits.find((k) => k.kitNumber === kitNumber)
  const appearance = useMemo(
    () => kitToAppearance(activeKit),
    [activeKit?.shirtColor, activeKit?.shortsColor, activeKit?.socksColor],
  )

  const isDirty = status === 'dirty'

  const patchUv = (partial: Partial<ShirtUvLayout>) => {
    setUv((prev) => ({ ...prev, ...partial }))
    setStatus('dirty')
  }

  const handleSaveUv = () => {
    saveTeamKitShirtUv(getDatabase(), teamId, kitNumber, uv)
    setSavedUv(cloneShirtUv(uv))
    setStatus('saved')
    window.setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1800)
  }

  const handleResetUv = () => {
    setUv(cloneShirtUv(savedUv))
    setStatus('idle')
  }

  const handleDefaultUv = () => {
    setUv(cloneShirtUv(DEFAULT_SHIRT_UV))
    setStatus('dirty')
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setUploadBusy(true)
    setUploadError(null)
    try {
      const processed = await processShirtTextureUpload(file)
      saveTeamKitShirtTexture(getDatabase(), teamId, kitNumber, processed.mimeType, processed.data)
      invalidateShirtTextures(teamId, kitNumber)
      setTextureKey((k) => k + 1)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Erro ao enviar textura.')
    } finally {
      setUploadBusy(false)
    }
  }

  const handleRemoveTexture = () => {
    deleteTeamKitShirtTexture(getDatabase(), teamId, kitNumber)
    invalidateShirtTextures(teamId, kitNumber)
    setTextureKey((k) => k + 1)
  }

  const onFrame = useMemo(() => (next: PlayerPreviewFrame) => setFrame(next), [])

  return (
    <section className="kit-preview-editor" aria-label="Editor de textura da camisa">
      <header className="kit-preview-editor__header">
        <div>
          <h4>Textura da camisa (UV)</h4>
          <p className="kit-preview-editor__lead">
            Envie um PNG com o desenho da camisa. Ajuste posição e escala no preview.
          </p>
        </div>
        <div className="kit-preview-editor__pills" role="tablist" aria-label="Uniforme">
          <button
            type="button"
            role="tab"
            aria-selected={kitNumber === 1}
            className={`kit-preview-pill${kitNumber === 1 ? ' kit-preview-pill--active' : ''}`}
            onClick={() => setKitNumber(1)}
          >
            Uniforme 1
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kitNumber === 2}
            className={`kit-preview-pill${kitNumber === 2 ? ' kit-preview-pill--active' : ''}`}
            onClick={() => setKitNumber(2)}
          >
            Uniforme 2
          </button>
        </div>
      </header>

      <div className="kit-preview-editor__upload">
        <div className="kit-preview-editor__upload-actions">
          <button
            type="button"
            className="menu-btn menu-btn--ghost"
            disabled={uploadBusy}
            onClick={() => fileRef.current?.click()}
          >
            {uploadBusy ? 'Enviando...' : hasTexture ? 'Trocar PNG' : 'Enviar PNG da camisa'}
          </button>
          {hasTexture ? (
            <button
              type="button"
              className="menu-btn menu-btn--danger"
              disabled={uploadBusy}
              onClick={handleRemoveTexture}
            >
              Remover textura
            </button>
          ) : null}
        </div>
        {uploadError ? <p className="kit-preview-editor__upload-error">{uploadError}</p> : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/png"
          hidden
          onChange={(e) => {
            void handleFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      <div className="kit-preview-editor__viewport">
        {!hasTexture ? (
          <div className="kit-preview-editor__overlay">
            Envie um PNG acima para ver a textura no boneco.
          </div>
        ) : null}
        <div className="kit-preview-editor__viewport-toolbar">
          <button
            type="button"
            className={`kit-preview-pill kit-preview-pill--sm${zoom === 'torso' ? ' kit-preview-pill--active' : ''}`}
            onClick={() => setZoom('torso')}
          >
            Zoom peito
          </button>
          <button
            type="button"
            className={`kit-preview-pill kit-preview-pill--sm${zoom === 'full' ? ' kit-preview-pill--active' : ''}`}
            onClick={() => setZoom('full')}
          >
            Corpo inteiro
          </button>
        </div>
        <Canvas
          key={graphicsMode}
          className="kit-preview-editor__canvas"
          shadows={graphicsMode === 'aaa'}
          dpr={[gfx.renderer.dprMin, gfx.renderer.dprMax]}
          gl={{ antialias: gfx.renderer.antialias }}
          camera={{ position: [0, 0.08, 0.75], fov: 38, near: 0.05, far: 20 }}
          onCreated={({ gl, scene }) => {
            configureGraphicsRenderer(gl, graphicsMode)
            configureGraphicsScene(scene, graphicsMode)
          }}
        >
          <SceneLighting />
          <Suspense fallback={null}>
            <PreviewRig
              teamId={teamId}
              kitNumber={kitNumber}
              appearance={appearance}
              uv={uv}
              textureKey={textureKey + refreshKey}
              onFrame={onFrame}
            />
          </Suspense>
          <PreviewCamera frame={frame} zoom={zoom} />
        </Canvas>
        <p className="kit-preview-editor__hint">Arraste para girar 360° · scroll para zoom</p>
      </div>

      {hasTexture ? (
        <div className="kit-preview-editor__sliders kit-preview-editor__sliders--standalone">
          <label className="kit-preview-toggle">
            <input
              type="checkbox"
              checked={uv.flipHorizontal}
              onChange={(e) => patchUv({ flipHorizontal: e.target.checked })}
            />
            <span>Espelhar horizontal (se o desenho estiver invertido)</span>
          </label>
          <SliderRow
            label="Zoom horizontal"
            value={uv.uvRepeatX}
            min={0.2}
            max={1}
            step={0.01}
            onChange={(v) => patchUv({ uvRepeatX: v })}
          />
          <SliderRow
            label="Zoom vertical"
            value={uv.uvRepeatY}
            min={0.2}
            max={1}
            step={0.01}
            onChange={(v) => patchUv({ uvRepeatY: v })}
          />
          <SliderRow
            label="Posição horizontal"
            value={uv.uvOffsetX}
            min={-1}
            max={1}
            step={0.01}
            onChange={(v) => patchUv({ uvOffsetX: v })}
          />
          <SliderRow
            label="Posição vertical"
            value={uv.uvOffsetY}
            min={-1}
            max={1}
            step={0.01}
            onChange={(v) => patchUv({ uvOffsetY: v })}
          />
        </div>
      ) : null}

      {hasTexture ? (
        <footer className="kit-preview-editor__footer">
          <div className="kit-preview-editor__status">
            {status === 'saved' ? (
              <span className="kit-preview-editor__status-msg kit-preview-editor__status-msg--ok">
                UV salvo
              </span>
            ) : isDirty ? (
              <span className="kit-preview-editor__status-msg kit-preview-editor__status-msg--warn">
                Alterações não salvas
              </span>
            ) : (
              <span className="kit-preview-editor__status-msg">Pronto</span>
            )}
          </div>
          <div className="kit-preview-editor__footer-actions">
            <button type="button" className="menu-btn menu-btn--primary" onClick={handleSaveUv}>
              Salvar UV
            </button>
            <button
              type="button"
              className="menu-btn menu-btn--ghost"
              onClick={handleResetUv}
              disabled={!isDirty}
            >
              Desfazer
            </button>
            <button type="button" className="menu-btn menu-btn--ghost" onClick={handleDefaultUv}>
              Padrão
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  )
}

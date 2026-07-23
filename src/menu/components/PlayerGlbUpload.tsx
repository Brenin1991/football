import { useRef, useState } from 'react'
import { getDatabase } from '../../db/database'
import { setEditionPlayerHasCustomGlb } from '../../db/queries'
import { deletePlayerGlb, putPlayerGlb } from '../../db/playerGlbStore'
import { validatePlayerGlbFile } from '../../db/playerGlbValidate'

type PlayerGlbUploadProps = {
  playerId: string
  hasCustomGlb: boolean
  refreshKey?: number
  onUpdated?: () => void
}

export function PlayerGlbUpload({
  playerId,
  hasCustomGlb,
  refreshKey = 0,
  onUpdated,
}: PlayerGlbUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  void refreshKey

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const validated = await validatePlayerGlbFile(file)
      await putPlayerGlb(playerId, validated.data, validated.fileName)
      setEditionPlayerHasCustomGlb(getDatabase(), playerId, true)
      setInfo(`${validated.fileName} · ${validated.clipCount} clips`)
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar GLB.')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await deletePlayerGlb(playerId)
      setEditionPlayerHasCustomGlb(getDatabase(), playerId, false)
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover GLB.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="player-glb-upload">
      <span className="player-glb-upload__label">Modelo 3D (.glb)</span>
      <p className="player-glb-upload__hint">
        Mesmo contrato do padrão: ossos Mixamo, meshes Ch38_*, animações. Rosto personalizado no
        Blender. Arquivo fica no IndexedDB (não no SQLite).
      </p>
      <div className="player-glb-upload__status pes-hud-surface">
        {hasCustomGlb ? 'Personalizado ativo' : 'Usando modelo padrão'}
      </div>
      <div className="player-glb-upload__actions">
        <button
          type="button"
          className="menu-btn menu-btn--ghost"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Validando...' : hasCustomGlb ? 'Trocar GLB' : 'Enviar GLB'}
        </button>
        {hasCustomGlb ? (
          <button
            type="button"
            className="menu-btn menu-btn--danger"
            disabled={busy}
            onClick={() => void handleRemove()}
          >
            Remover
          </button>
        ) : null}
      </div>
      {info ? <p className="player-glb-upload__info">{info}</p> : null}
      {error ? <p className="player-glb-upload__error">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

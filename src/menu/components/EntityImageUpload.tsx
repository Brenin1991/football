import { useRef, useState } from 'react'
import { getDatabase } from '../../db/database'
import type { EntityImageType } from '../../db/entityImages'
import { IMAGE_ACCEPT } from '../../db/entityImages'
import { deleteEntityImage, hasEntityImage, setEntityImage } from '../../db/imageQueries'
import { invalidateEntityImageCache } from '../../lib/entityImageCache'
import { processImageUpload } from '../../lib/processImage'
import { EntityImage } from '../../components/EntityImage'

type EntityImageUploadProps = {
  entityType: EntityImageType
  entityId: string
  label: string
  refreshKey?: number
  onUpdated?: () => void
  variant?: 'crest' | 'photo'
}

export function EntityImageUpload({
  entityType,
  entityId,
  label,
  refreshKey = 0,
  onUpdated,
  variant = 'crest',
}: EntityImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasImage = (() => {
    void refreshKey
    try {
      return hasEntityImage(getDatabase(), entityType, entityId)
    } catch {
      return false
    }
  })()

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const processed = await processImageUpload(file, entityType)
      setEntityImage(getDatabase(), entityType, entityId, processed.mimeType, processed.data)
      invalidateEntityImageCache(entityType, entityId)
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar imagem.')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = () => {
    deleteEntityImage(getDatabase(), entityType, entityId)
    invalidateEntityImageCache(entityType, entityId)
    onUpdated?.()
  }

  const fallbackClass =
    variant === 'photo' ? 'entity-image-fallback entity-image-fallback--photo' : 'entity-image-fallback entity-image-fallback--crest'

  return (
    <div className={`entity-image-upload entity-image-upload--${variant}`}>
      <span className="entity-image-upload__label">{label}</span>
      <div className="entity-image-upload__frame pes-hud-surface">
        <EntityImage
          entityType={entityType}
          entityId={entityId}
          alt={label}
          refreshKey={refreshKey}
          className={`entity-image-upload__img entity-image-upload__img--${variant}`}
          fallback={<div className={fallbackClass} aria-hidden />}
        />
      </div>
      <div className="entity-image-upload__actions">
        <button
          type="button"
          className="menu-btn menu-btn--ghost"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Enviando...' : hasImage ? 'Trocar' : 'Enviar'}
        </button>
        {hasImage ? (
          <button type="button" className="menu-btn menu-btn--danger" disabled={busy} onClick={handleRemove}>
            Remover
          </button>
        ) : null}
      </div>
      {error ? <p className="entity-image-upload__error">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

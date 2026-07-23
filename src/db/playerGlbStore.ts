/** IndexedDB — GLBs personalizados (binário grande; SQLite só guarda o flag). */

const DB_NAME = 'futebol-player-glb'
const DB_VERSION = 2
const STORE = 'glbs'

export type PlayerGlbRecord = {
  playerId: string
  /** ArrayBuffer — mais confiável que File/Blob no IDB */
  data: ArrayBuffer
  fileName: string
  mimeType: string
  updatedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'playerId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Falha ao abrir IndexedDB'))
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Erro IndexedDB'))
  })
}

function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Falha na transação IndexedDB'))
    tx.onabort = () => reject(tx.error ?? new Error('Transação IndexedDB abortada'))
  })
}

export async function putPlayerGlb(
  playerId: string,
  data: ArrayBuffer,
  fileName: string,
  mimeType = 'model/gltf-binary',
): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const record: PlayerGlbRecord = {
      playerId,
      data,
      fileName,
      mimeType,
      updatedAt: Date.now(),
    }
    tx.objectStore(STORE).put(record)
    await waitTx(tx)
  } finally {
    db.close()
  }
}

export async function getPlayerGlb(playerId: string): Promise<PlayerGlbRecord | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const row = (await idbReq(tx.objectStore(STORE).get(playerId))) as
      | PlayerGlbRecord
      | { playerId: string; blob?: Blob; data?: ArrayBuffer; fileName?: string; mimeType?: string }
      | undefined
    if (!row) return null

    // Compat: registros antigos com `blob` (File/Blob)
    if (row.data instanceof ArrayBuffer && row.data.byteLength > 0) {
      return row as PlayerGlbRecord
    }
    const legacy = row as { blob?: Blob; fileName?: string; mimeType?: string }
    if (legacy.blob && legacy.blob.size > 0) {
      const data = await legacy.blob.arrayBuffer()
      return {
        playerId,
        data,
        fileName: legacy.fileName ?? 'model.glb',
        mimeType: legacy.mimeType ?? (legacy.blob.type || 'model/gltf-binary'),
        updatedAt: Date.now(),
      }
    }
    return null
  } finally {
    db.close()
  }
}

export async function getPlayerGlbBlob(playerId: string): Promise<Blob | null> {
  const row = await getPlayerGlb(playerId)
  if (!row) return null
  const copy = new Uint8Array(row.data.byteLength)
  copy.set(new Uint8Array(row.data))
  return new Blob([copy.buffer], { type: row.mimeType || 'model/gltf-binary' })
}

export async function hasPlayerGlb(playerId: string): Promise<boolean> {
  const row = await getPlayerGlb(playerId)
  return row != null && row.data.byteLength > 0
}

export async function deletePlayerGlb(playerId: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(playerId)
    await waitTx(tx)
  } finally {
    db.close()
  }
}

/** IndexedDB — dump binário do SQLite da edição (localStorage estoura com texturas). */

const DB_NAME = 'futebol-edition-idb'
const DB_VERSION = 1
const STORE = 'sqlite'
const RECORD_KEY = 'main'

export type EditionDbRecord = {
  id: typeof RECORD_KEY
  data: ArrayBuffer
  updatedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Falha ao abrir IndexedDB da edição'))
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

export async function putEditionDbBytes(bytes: Uint8Array): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const record: EditionDbRecord = {
      id: RECORD_KEY,
      data: copy.buffer,
      updatedAt: Date.now(),
    }
    tx.objectStore(STORE).put(record)
    await waitTx(tx)
  } finally {
    db.close()
  }
}

export async function getEditionDbBytes(): Promise<Uint8Array | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const row = (await idbReq(tx.objectStore(STORE).get(RECORD_KEY))) as
      | EditionDbRecord
      | undefined
    if (!row?.data || !(row.data instanceof ArrayBuffer) || row.data.byteLength === 0) {
      return null
    }
    return new Uint8Array(row.data.slice(0))
  } finally {
    db.close()
  }
}

export async function clearEditionDbBytes(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(RECORD_KEY)
    await waitTx(tx)
  } finally {
    db.close()
  }
}

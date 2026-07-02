import fs from 'node:fs'
import path from 'node:path'

/** Qualquer extensão de áudio comum — nome do arquivo livre */
export const AUDIO_EXT_RE =
  /\.(mp3|ogg|wav|m4a|aac|flac|webm|opus|aiff|aif|wma)$/i

export function isAudioFile(name) {
  return !name.startsWith('.') && AUDIO_EXT_RE.test(name)
}

/**
 * Escaneia public/sfx/{sfxFolder}/{categoria}/* e lista todos os áudios.
 * Pastas vazias entram no manifest como [].
 */
export function scanAudioManifest(publicRoot, sfxFolder) {
  const base = path.join(publicRoot, 'sfx', sfxFolder)
  const manifest = {}

  if (!fs.existsSync(base)) return manifest

  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue

    const catDir = path.join(base, entry.name)
    let files = []

    try {
      files = fs
        .readdirSync(catDir)
        .filter(isAudioFile)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    } catch {
      files = []
    }

    manifest[entry.name] = files
  }

  return manifest
}

export function writeAudioManifest(publicRoot, sfxFolder) {
  const manifest = scanAudioManifest(publicRoot, sfxFolder)
  const outPath = path.join(publicRoot, 'sfx', sfxFolder, 'manifest.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

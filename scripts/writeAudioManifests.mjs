import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAudioManifest } from './audioManifestUtils.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(root, 'public')

for (const folder of ['narracao', 'crowd']) {
  const manifest = writeAudioManifest(publicRoot, folder)
  const total = Object.values(manifest).reduce((n, files) => n + files.length, 0)
  console.log(`[audio-manifest] ${folder}: ${total} clip(s) em ${Object.keys(manifest).length} pasta(s)`)
}

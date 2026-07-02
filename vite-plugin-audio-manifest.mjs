import path from 'node:path'
import { scanAudioManifest, writeAudioManifest } from './scripts/audioManifestUtils.mjs'

/**
 * Gera manifest.json dinamicamente a partir dos arquivos nas pastas de sfx.
 * Dev: serve manifest atualizado a cada request (qualquer nome/extensão de áudio).
 * Build: grava manifest.json em public antes do bundle.
 */
export function audioManifestPlugin(options = {}) {
  const folders = options.folders ?? ['narracao', 'crowd']
  let configRoot = process.cwd()
  let publicDir = 'public'

  const resolvePublicRoot = () =>
    path.isAbsolute(publicDir) ? publicDir : path.join(configRoot, publicDir)

  const isManifestRequest = (url) => {
    if (!url) return null
    const clean = url.split('?')[0]
    for (const folder of folders) {
      if (clean === `/sfx/${folder}/manifest.json`) return folder
    }
    return null
  }

  return {
    name: 'vite-plugin-audio-manifest',

    configResolved(config) {
      configRoot = config.root
      publicDir = config.publicDir
    },

    configureServer(server) {
      const publicRoot = resolvePublicRoot()

      server.middlewares.use((req, res, next) => {
        const folder = isManifestRequest(req.url)
        if (!folder) {
          next()
          return
        }

        const manifest = scanAudioManifest(publicRoot, folder)
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(manifest))
      })

      const watchRoots = folders.map((f) => path.join(publicRoot, 'sfx', f))
      for (const watchRoot of watchRoots) {
        server.watcher.add(watchRoot)
      }
    },

    buildStart() {
      const publicRoot = resolvePublicRoot()
      for (const folder of folders) {
        writeAudioManifest(publicRoot, folder)
      }
    },
  }
}

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { audioManifestPlugin } from './vite-plugin-audio-manifest.mjs'

export default defineConfig({
  plugins: [
    react(),
    audioManifestPlugin({ folders: ['narracao', 'crowd'] }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.glb'],
})

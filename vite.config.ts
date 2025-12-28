import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) {
          // Start Electron with our app
          args.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3', 'jzz', 'bufferutil', 'utf-8-validate']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          // Reload renderer without restarting Electron
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@electron': path.resolve(__dirname, './electron')
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      overlay: false
    }
  }
})

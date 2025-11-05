import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import viteCompression from 'vite-plugin-compression'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

// Emulate __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
const isTestEnv =
  process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

const certDirectory = path.join(__dirname, '../../../certs')
const keyPath = path.join(certDirectory, 'localhost+2-key.pem')
const certPath = path.join(certDirectory, 'localhost+2.pem')

const httpsConfig =
  !isTestEnv && fs.existsSync(keyPath) && fs.existsSync(certPath)
    ? {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      }
    }
    : {}

export default defineConfig({
  plugins: [react(), tailwindcss(), viteCompression()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils')
    },
    dedupe: ['react', 'react-dom']
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    reportCompressedSize: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      treeshake: true,
      onwarn(warning, warn) {
        // Silence common non-actionable warnings to keep CI clean
        if (warning.code === 'CIRCULAR_DEPENDENCY') return
        if (warning.code === 'CHUNK_SIZE_LIMIT') return
        warn(warning)
      }
    }
  },
  server: {
    ...httpsConfig
  }
})

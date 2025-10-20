import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import tailwindcss from '@tailwindcss/vite'
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
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@assets': path.resolve(__dirname, 'src/assets'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@hooks': path.resolve(__dirname, 'src/hooks'),
      '@utils': path.resolve(__dirname, 'src/utils')
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    typecheck: {
      tsconfig: './tsconfig.test.json'
    },
    exclude: [...configDefaults.exclude, 'dist'],
    setupFiles: './tests/setup.ts',
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/node_modules/**',
        'tests/**',
        'src/main.tsx' // exclude app bootstrap
      ],
      thresholds: {
        functions: 80,
        branches: 80,
        lines: 80,
        statements: 80,
        perFile: true
      }
    }
  },
  server: {
    ...httpsConfig
  }
})

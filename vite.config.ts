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
    https: {
      key: fs.readFileSync(
        path.join(__dirname, '../../../certs', 'localhost+2-key.pem')
      ),
      cert: fs.readFileSync(
        path.join(__dirname, '../../../certs', 'localhost+2.pem')
      )
    }
  }
})

import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// Emulate __dirname in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Vitest config (separate from Vite 7 app config)
export default defineConfig({
  plugins: [react()],
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
      exclude: ['**/node_modules/**', 'tests/**', 'src/main.tsx'],
      thresholds: {
        functions: 80,
        branches: 80,
        lines: 80,
        statements: 80,
        perFile: false
      }
    }
  }
})

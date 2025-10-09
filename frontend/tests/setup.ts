/// <reference types="vitest" />
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Optional: mock scroll/resize events or suppress console.error for hydration mismatches
// Optional: mock window.matchMedia if your components use it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
})

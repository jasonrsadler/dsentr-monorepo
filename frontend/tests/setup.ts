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

// Mock Stripe loader globally to avoid real network and to control redirect calls.
vi.mock('@stripe/stripe-js', () => {
  return {
    // loadStripe resolves to a stub with a redirectToCheckout method
    loadStripe: vi.fn(async () => ({
      redirectToCheckout: vi.fn(async (_opts?: any) => ({ error: undefined }))
    }))
  }
})

// Prevent actual navigation during tests when components call window.location.assign
Object.defineProperty(window, 'location', {
  writable: true,
  value: {
    ...window.location,
    assign: vi.fn()
  }
})

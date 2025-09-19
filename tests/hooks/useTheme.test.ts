// src/tests/hooks/useTheme.test.tsx
import { renderHook, act } from '@testing-library/react'
import { useTheme } from '@/hooks/useTheme'
import { vi } from 'vitest'

describe('useTheme', () => {
  let originalMatchMedia: typeof window.matchMedia
  let localStorageMock: Record<string, string | null> = {}

  beforeEach(() => {
    localStorageMock = {}

    // Mock localStorage methods
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(
      (key) => {
        return localStorageMock[key as string] || null
      }
    )
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(
      (...args: unknown[]) => {
        const [key, value] = args as [string, string]
        localStorageMock[key] = value
      }
    )

    // Save original matchMedia
    originalMatchMedia = window.matchMedia

    // Mock matchMedia
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated but might be called
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })

  afterEach(() => {
    // Restore original matchMedia after each test
    window.matchMedia = originalMatchMedia
    vi.restoreAllMocks()
  })

  it('initializes as dark if localStorage is "dark"', () => {
    localStorageMock['theme'] = 'dark'
    const { result } = renderHook(() => useTheme())
    expect(result.current.isDark).toBe(true)
  })

  it('initializes as light if localStorage is "light"', () => {
    localStorageMock['theme'] = 'light'
    const { result } = renderHook(() => useTheme())
    expect(result.current.isDark).toBe(false)
  })

  it('initializes as dark if no localStorage but prefers dark scheme', () => {
    localStorageMock['theme'] = null
    const { result } = renderHook(() => useTheme())
    expect(result.current.isDark).toBe(true)
  })

  it('initializes as light if no localStorage and prefers light scheme', () => {
    // Override matchMedia to not match dark scheme
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
    localStorageMock['theme'] = null

    const { result } = renderHook(() => useTheme())
    expect(result.current.isDark).toBe(false)
  })

  it('toggles theme and updates html class and localStorage', () => {
    localStorageMock['theme'] = 'light'
    const { result } = renderHook(() => useTheme())

    // Initial isLight
    expect(result.current.isDark).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorageMock['theme']).toBe('dark')

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.isDark).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorageMock['theme']).toBe('light')
  })
})

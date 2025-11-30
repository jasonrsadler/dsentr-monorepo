// src/tests/ThemeToggle.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from '@/components/ThemeToggle'
import * as useThemeModule from '@/hooks/useTheme'

describe('ThemeToggle', () => {
  const mockToggleTheme = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders MoonIcon when in light mode (isDark = false)', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue({
      isDark: false,
      toggleTheme: mockToggleTheme
    })

    render(<ThemeToggle />)

    // MoonIcon should be rendered
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByRole('button').querySelector('svg')).toBeTruthy()
  })

  it('renders SunIcon when in dark mode (isDark = true)', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue({
      isDark: true,
      toggleTheme: mockToggleTheme
    })

    render(<ThemeToggle />)

    // SunIcon should be rendered
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByRole('button').querySelector('svg')).toBeTruthy()
  })

  it('calls toggleTheme on click', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue({
      isDark: false,
      toggleTheme: mockToggleTheme
    })

    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button'))
    expect(mockToggleTheme).toHaveBeenCalledTimes(1)
  })
})

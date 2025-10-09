// src/tests/ProtectedRoute.test.tsx
import { describe, it, vi, beforeEach } from 'vitest'
const mockUseNavigate = vi.fn()

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProtectedRoute from '@/components/ProtectedRoute'
import * as AuthStore from '@/stores/auth'

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // mock useNavigate to be a spy
    vi.mock('react-router-dom', async () => {
      const actual =
        await vi.importActual<typeof import('react-router-dom')>(
          'react-router-dom'
        )
      return {
        ...actual,
        useNavigate: () => mockUseNavigate
      }
    })
  })

  it('renders children when user is present and not loading', () => {
    vi.spyOn(AuthStore, 'useAuth').mockReturnValue({
      user: { id: '123' },
      isLoading: false
    })

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    )

    expect(screen.getByText('Protected Content')).toBeInTheDocument()
    expect(mockUseNavigate).not.toHaveBeenCalled()
  })

  it('renders nothing when isLoading is true', () => {
    vi.spyOn(AuthStore, 'useAuth').mockReturnValue({
      user: null,
      isLoading: true
    })

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Should not appear</div>
        </ProtectedRoute>
      </MemoryRouter>
    )

    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument()
    expect(mockUseNavigate).not.toHaveBeenCalled()
  })

  it('navigates to /login when unauthenticated and not loading', () => {
    vi.spyOn(AuthStore, 'useAuth').mockReturnValue({
      user: null,
      isLoading: false
    })

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Should not appear</div>
        </ProtectedRoute>
      </MemoryRouter>
    )

    expect(mockUseNavigate).toHaveBeenCalledWith('/login', { replace: true })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '@/App'

// Mock the auth store
vi.mock('@/stores/auth', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    checkAuth: vi.fn()
  })
}))

// Optionally mock components that don't matter here
vi.mock('@/components/ProtectedRoute', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))
vi.mock('@/components/DSentrLogo', () => ({
  DSentrLogo: () => <div data-testid="logo" />
}))

describe('App', () => {
  it('renders header and footer', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

    expect(screen.getByText('DSentr')).toBeInTheDocument()
    expect(screen.getByText(/all rights reserved/i)).toBeInTheDocument()
  })

  it('renders About page via route', async () => {
    render(
      <MemoryRouter initialEntries={['/about']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /about/i })
      ).toBeInTheDocument()
    })
  })

  it('renders NotFound page on invalid route', () => {
    render(
      <MemoryRouter initialEntries={['/thispagedoesnotexist']}>
        <App />
      </MemoryRouter>
    )

    expect(screen.getByText(/404/i)).toBeInTheDocument()
  })
})

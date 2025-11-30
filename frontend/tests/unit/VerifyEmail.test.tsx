import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
// Import `vi` to get access to the Mock type
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest'
import VerifyEmail from '@/VerifyEmail'
import * as ReactRouterDom from 'react-router-dom'

// 1. Mock the module and define the mock function inside the factory
vi.mock('@/lib', () => ({
  verifyEmail: vi.fn()
}))

// 2. Import the function *after* it has been mocked
import { verifyEmail } from '@/lib'

// 3. Get a typed, trackable reference using `as vi.Mock` (the fix)
const mockVerifyEmail = verifyEmail as Mock
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  // Explicitly type `importOriginal` to resolve the spread operator error
  const actual = await importOriginal<typeof ReactRouterDom>()
  return {
    ...actual, // TypeScript now knows `actual` is an object
    useNavigate: () => mockNavigate
  }
})

// Helper function to render the component within a router
const renderComponent = (token: string | null) => {
  const path = token ? `/verify-email?token=${token}` : '/verify-email'
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/dashboard" element={<div>Dashboard Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('VerifyEmail', () => {
  beforeEach(() => {
    // Now you can safely call mock methods on the typed mock
    mockVerifyEmail.mockReset()
    mockNavigate.mockReset()
    vi.useRealTimers()
  })

  it('shows the verifying state initially', () => {
    renderComponent('some-token')
    expect(screen.getByText('Verifying your email...')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /verifying/i })
    ).toBeInTheDocument()
  })

  it('shows success and redirects when verification is successful', async () => {
    mockVerifyEmail.mockResolvedValue({ success: true })

    renderComponent('valid-token')

    await act(async () => {})

    expect(
      screen.getByRole('heading', { name: /email verified/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Email verified! Redirecting...')
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('shows an error message when verification fails with success: false', async () => {
    mockVerifyEmail.mockResolvedValue({
      success: false,
      message: 'Your token is invalid.'
    })

    renderComponent('invalid-token')

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /verification failed/i })
      ).toBeInTheDocument()
    })
    expect(screen.getByText('Your token is invalid.')).toBeInTheDocument()
  })

  it('shows an error message when verification throws an exception', async () => {
    mockVerifyEmail.mockRejectedValue(new Error('Network Error'))

    renderComponent('error-token')

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /verification failed/i })
      ).toBeInTheDocument()
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })
  })

  it('does not call verifyEmail if the token is missing from the URL', () => {
    renderComponent(null)
    expect(screen.getByText('Verifying your email...')).toBeInTheDocument()
    expect(mockVerifyEmail).not.toHaveBeenCalled()
  })

  it('does not call verifyEmail more than once on re-renders', async () => {
    mockVerifyEmail.mockResolvedValue({ success: true })

    const { rerender } = renderComponent('once-token')

    await waitFor(() => {
      expect(mockVerifyEmail).toHaveBeenCalledTimes(1)
    })

    rerender(
      <MemoryRouter initialEntries={['/verify-email?token=once-token']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmail />} />
        </Routes>
      </MemoryRouter>
    )

    expect(mockVerifyEmail).toHaveBeenCalledTimes(1)
  })
})

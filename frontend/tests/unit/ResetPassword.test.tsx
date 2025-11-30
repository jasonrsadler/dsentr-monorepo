import { vi } from 'vitest'
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate
  }
})
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ResetPassword from '@/ResetPassword'
// Mock SVG icons
vi.mock('@/assets/svg-components/LockIcon', () => ({
  default: () => <div>LockIcon</div>
}))
vi.mock('@/assets/svg-components/HidePasswordIcon', () => ({
  default: () => <div>Hide</div>
}))
vi.mock('@/assets/svg-components/ShowPasswordIcon', () => ({
  default: () => <div>Show</div>
}))

// Mock CSRF utility
vi.mock('@/lib/csrfCache', () => ({
  getCsrfToken: vi.fn().mockResolvedValue('mock-csrf-token')
}))

// Stub fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Render helper with router and token
const renderWithToken = (token: string | null) => {
  const path = token ? `/reset-password/${token}` : '/reset-password'
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password/:token?" element={<ResetPassword />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('shows error if no token', async () => {
    renderWithToken(null)
    expect(await screen.findByText(/missing reset token/i)).toBeInTheDocument()
  })

  it('shows error for invalid token format', async () => {
    renderWithToken('bad!!format')
    expect(await screen.findByText(/invalid token format/i)).toBeInTheDocument()
  })

  it('shows error if token is invalid from backend', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Invalid or expired token.' })
    })
    renderWithToken('badtoken123')
    expect(
      await screen.findByText(/invalid or expired token/i)
    ).toBeInTheDocument()
  })

  it('shows form if token is valid', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    renderWithToken('validtoken123')

    const passwordInputs = await screen.findAllByLabelText(/new password/i)
    const confirmPasswordInputs =
      screen.getAllByLabelText(/confirm new password/i)
    expect(passwordInputs[0]).toBeInTheDocument()
    expect(confirmPasswordInputs[0]).toBeInTheDocument()
  })

  it('shows error if fields are empty on submit', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    renderWithToken('validtoken123')

    fireEvent.click(
      await screen.findByRole('button', { name: /reset password/i })
    )
    expect(await screen.findByText(/fill in both fields/i)).toBeInTheDocument()
  })

  it('shows error for password mismatch', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    renderWithToken('validtoken123')

    const passwordInputs = await screen.findAllByLabelText(/new password/i)
    fireEvent.change(passwordInputs[0], {
      target: { value: 'Password123!' }
    })
    const confirmPasswordInputs =
      screen.getAllByLabelText(/confirm new password/i)
    fireEvent.change(confirmPasswordInputs[0], {
      target: { value: 'Different123!' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
    expect(
      await screen.findByText(/passwords do not match/i)
    ).toBeInTheDocument()
  })

  it('shows password strength meter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    renderWithToken('validtoken123')

    const weakPasswordInputs = await screen.findAllByLabelText(/new password/i)
    fireEvent.change(weakPasswordInputs[0], {
      target: { value: 'abc' }
    })
    expect(screen.getByText(/password strength: weak/i)).toBeInTheDocument()

    const passwordInputs = screen.getAllByLabelText(/new password/i)
    fireEvent.change(passwordInputs[0], {
      target: { value: 'Abc123!xyz' }
    })
    expect(screen.getByText(/password strength: strong/i)).toBeInTheDocument()
  })

  it('successfully resets and redirects to login', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({})
    }) // verify token

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'Password reset' })
    }) // reset password

    renderWithToken('validtoken123')

    const newPasswordInputs = await screen.findAllByLabelText(/new password/i)
    fireEvent.change(newPasswordInputs[0], {
      target: { value: 'Password123!' }
    })

    const confirmPasswordInputs =
      screen.getAllByLabelText(/confirm new password/i)
    fireEvent.change(confirmPasswordInputs[0], {
      target: { value: 'Password123!' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    // Wait for success message (do this BEFORE navigation wipes it)
    await screen.findByText(/successfully reset/i)

    // Now check that navigation is scheduled (either with jest timers or just spy)
    await waitFor(
      () => {
        expect(mockNavigate).toHaveBeenCalledWith('/login')
      },
      { timeout: 3000 }
    )
  })

  it('shows error if reset fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true }) // verify token
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Reset failed' })
    }) // reset submit

    renderWithToken('validtoken123')

    const passwordInputs = await screen.findAllByLabelText(/new password/i)
    fireEvent.change(passwordInputs[0], {
      target: { value: 'Password123!' }
    })
    const confirmPasswordInputs =
      screen.getAllByLabelText(/confirm new password/i)
    fireEvent.change(confirmPasswordInputs[0], {
      target: { value: 'Password123!' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
    expect(await screen.findByText(/reset failed/i)).toBeInTheDocument()
  })

  it('toggles password visibility', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true }) // token verify succeeds

    renderWithToken('validtoken123')

    // Wait for form to render
    const toggleButtons = await screen.findAllByRole('button', {
      name: /show/i
    })
    expect(toggleButtons.length).toBeGreaterThan(0)

    const passwordInputs = screen.getAllByLabelText(/new password/i)
    expect(passwordInputs[0]).toHaveAttribute('type', 'password')

    fireEvent.click(toggleButtons[0])
    expect(passwordInputs[0]).toHaveAttribute('type', 'text')
  })
})

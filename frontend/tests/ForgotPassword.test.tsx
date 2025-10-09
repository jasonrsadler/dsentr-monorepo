import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ForgotPasswordPage from '@/ForgotPassword'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

// Mock CSRF + fetch
vi.mock('@/lib/csrfCache', () => ({
  getCsrfToken: vi.fn(() => Promise.resolve('mock-csrf-token'))
}))

const fetchMock = vi.fn()
global.fetch = fetchMock

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  function setup() {
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>
    )
  }

  it('renders the form', () => {
    setup()
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /send reset link/i })
    ).toBeInTheDocument()
  })

  it('shows success message on successful submission', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })

    setup()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() =>
      expect(screen.getByText(/reset link sent/i)).toBeInTheDocument()
    )
  })

  it('shows error message on failed submission', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Email not found' })
    })

    setup()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'fail@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() =>
      expect(screen.getByText(/email not found/i)).toBeInTheDocument()
    )
  })

  it('shows fallback error on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'))

    setup()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'error@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() =>
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    )
  })
})

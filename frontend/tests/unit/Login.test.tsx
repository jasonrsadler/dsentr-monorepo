import { Mock, vi } from 'vitest'
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate // this is key — a function that returns the mockNavigate function
  }
})

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import { loginWithEmail } from '@/lib'
import Login from '@/Login'

// Setup helpers
const mockLogin = vi.fn()

// Mocks
vi.mock('@/stores/auth', () => ({
  useAuth: vi.fn()
}))

vi.mock('@/lib', () => ({
  loginWithEmail: vi.fn(),
  API_BASE_URL: 'https://api.example.com'
}))

describe('<Login />', () => {
  let originalLocation: Location

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useAuth as unknown as Mock).mockReturnValue({
      user: null,
      isLoading: false,
      login: mockLogin,
      logout: vi.fn(),
      checkAuth: vi.fn()
    })

    originalLocation = window.location

    // @ts-expect-error: Overriding readonly property for testing
    delete window.location

    // Assign mock location
    window.location = {
      ...originalLocation,
      href: 'http://localhost/login?error=SomethingFailed',
      search: '?error=SomethingFailed',
      pathname: '/login',
      assign: vi.fn(),
      replace: vi.fn()
    } as any
  })

  afterEach(() => {
    // @ts-expect-error: Restoring original location
    window.location = originalLocation
  })

  it('renders login form', () => {
    render(<Login />, { wrapper: MemoryRouter })
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByText(/log\s?in to dsentr/i)).toBeInTheDocument()
  })

  it('submits login form and calls loginWithEmail, then navigates', async () => {
    const mockUser = { email: 'test@example.com' }
    ;(loginWithEmail as Mock).mockResolvedValue({
      success: true,
      data: { user: mockUser }
    })

    render(<Login />, { wrapper: MemoryRouter })

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' }
    })

    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' }
    })
    // Click the visible submit button; this path is more reliable
    // in JSDOM than dispatching a synthetic submit on the form.
    fireEvent.click(screen.getByRole('button', { name: /log\s?in/i }))

    await waitFor(() => {
      expect(loginWithEmail).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        remember: false
      })
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('displays error if login fails', async () => {
    ;(loginWithEmail as Mock).mockResolvedValue({
      success: false,
      message: 'Invalid credentials'
    })

    render(<Login />, { wrapper: MemoryRouter })

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'wrong@example.com' }
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpass' }
    })
    fireEvent.click(screen.getByRole('button', { name: /log\s?in/i }))

    await screen.findByText('Invalid credentials')
  })

  it('redirects to dashboard if already logged in', () => {
    // Override mocked useAuth
    ;(useAuth as unknown as Mock).mockReturnValue({
      user: { email: 'user@example.com' },
      isLoading: false,
      login: mockLogin
    })

    render(<Login />, { wrapper: MemoryRouter })
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
  })

  it('calls correct OAuth URLs when OAuth buttons clicked', async () => {
    render(<Login />, { wrapper: MemoryRouter })
    const googleButtons = screen.getAllByText(/Sign in with Google/i)
    expect(googleButtons.length).toBeGreaterThan(1)
    fireEvent.click(googleButtons[0])
    const githubButtons = screen.getAllByText(/Sign in with GitHub/i)
    expect(githubButtons.length).toBeGreaterThan(1)

    fireEvent.click(googleButtons[0])
    expect(window.location.href).toBe(
      'https://api.example.com/api/auth/google-login'
    )

    fireEvent.click(githubButtons[0])
    expect(window.location.href).toBe(
      'https://api.example.com/api/auth/github-login'
    )
  })
})

vi.mock('@/assets/svg-components/PlugIcon', () => ({
  default: () => <div data-testid="plug-icon" />
}))
vi.mock('@/assets/svg-components/ClockIcon', () => ({
  default: () => <div data-testid="clock-icon" />
}))
vi.mock('@/assets/svg-components/ShieldIcon', () => ({
  default: () => <div data-testid="shield-icon" />
}))
vi.mock('@/assets/svg-components/WorkflowIllustration', () => ({
  WorkflowIllustration: () => <div data-testid="workflow-illustration" />
}))
vi.mock('@/components/GoogleSignupButton', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} data-testid="google-signup">
      Mock Google
    </button>
  )
}))

vi.mock('@/components/GithubLoginButton', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} data-testid="github-login">
      Mock GitHub
    </button>
  )
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SignupPage from '@/Signup'
import { vi } from 'vitest'

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>
  )
}

describe('SignupPage', () => {
  beforeEach(() => {
    renderWithRouter()
  })

  it('renders all input fields and buttons', () => {
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getAllByLabelText(/password/i).length).toBe(2)
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument()
  })

  it('shows validation errors when submitting empty form', async () => {
    const inputButtons = screen.getAllByRole('button', { name: /sign up/i })
    fireEvent.click(inputButtons[0])
    await waitFor(() => {
      const inputErrors1 = screen.getAllByText(/valid first name is required/i)
      expect(inputErrors1[0]).toBeInTheDocument()
      const inputErrors2 = screen.getAllByText(/valid last name is required/i)
      expect(inputErrors2[0]).toBeInTheDocument()
      const inputErrors3 = screen.getAllByText(/a valid email is required/i)
      expect(inputErrors3[0]).toBeInTheDocument()
      const inputErrors4 = screen.getAllByText(/password is required/i)
      expect(inputErrors4[0]).toBeInTheDocument()
      const inputErrors5 = screen.getAllByText(/verify password is required/i)
      expect(inputErrors5[0]).toBeInTheDocument()
    })
  })

  it('shows password mismatch error', async () => {
    fireEvent.change(screen.getByLabelText(/first name/i), {
      target: { value: 'Alice' }
    })
    fireEvent.change(screen.getByLabelText(/last name/i), {
      target: { value: 'Smith' }
    })
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'alice@example.com' }
    })
    fireEvent.change(screen.getAllByLabelText(/password/i)[0], {
      target: { value: 'Password123' }
    })
    fireEvent.change(screen.getByLabelText(/verify password/i), {
      target: { value: 'Wrong123' }
    })
    const inputButtons = screen.getAllByRole('button', { name: /sign up/i })
    fireEvent.click(inputButtons[0])
    await waitFor(() => {
      expect(screen.getByText(/passwords don't match/i)).toBeInTheDocument()
    })
  })

  it('displays password strength feedback', () => {
    const passwordField = screen.getAllByLabelText(/password/i)[0]

    fireEvent.change(passwordField, { target: { value: 'weak' } })
    expect(screen.getByText(/weak/i)).toBeInTheDocument()

    fireEvent.change(passwordField, { target: { value: 'Mod123' } })
    expect(screen.getByText(/moderate/i)).toBeInTheDocument()

    fireEvent.change(passwordField, { target: { value: 'Strong123!' } })
    expect(screen.getByText(/strong/i)).toBeInTheDocument()
  })
})

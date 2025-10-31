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

vi.mock('@/lib', async () => {
  const actual = await vi.importActual<typeof import('@/lib')>('@/lib')
  return {
    ...actual,
    signupUser: vi.fn()
  }
})

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'
import SignupPage from '@/Signup'
import { signupUser } from '@/lib'

function renderWithRouter(initialEntry = '/signup') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SignupPage />
    </MemoryRouter>
  )
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn() as unknown as typeof fetch
    ;(signupUser as Mock).mockResolvedValue({
      success: true,
      message: 'ok'
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders base form fields without invite', () => {
    renderWithRouter()
    expect(screen.getByLabelText(/First Name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email/i)).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument()
  })

  it('shows validation errors when submitting empty form', async () => {
    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    await waitFor(() => {
      expect(
        screen.getByText(/Valid First Name is required/i)
      ).toBeInTheDocument()
      expect(screen.getByText(/A valid Email is required/i)).toBeInTheDocument()
    })
  })

  it('prefills invite email and joins workspace when invite is valid', async () => {
    ;(global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        invitation: {
          id: 'invite-id',
          workspace_id: 'workspace-id',
          email: 'invited@example.com',
          role: 'user',
          token: 'invite-token',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          accepted_at: null,
          revoked_at: null,
          declined_at: null
        },
        expired: false,
        revoked: false,
        accepted: false,
        declined: false
      })
    })

    renderWithRouter('/signup?invite=invite-token')

    await waitFor(() => {
      expect(
        screen.getByText(/You're invited to join a workspace/i)
      ).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/Email/i)).toHaveValue('invited@example.com')
    expect(screen.getByLabelText(/Email/i)).toHaveAttribute('readonly')

    fireEvent.change(screen.getByLabelText(/First Name/i), {
      target: { value: 'Alice' }
    })
    fireEvent.change(screen.getByLabelText(/Last Name/i), {
      target: { value: 'Smith' }
    })
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: 'Password123!' }
    })
    fireEvent.change(screen.getByLabelText(/Verify Password/i), {
      target: { value: 'Password123!' }
    })

    // Accept terms to enable submission
    fireEvent.click(screen.getByRole('checkbox'))

    const joinButtons = screen.getAllByRole('button', {
      name: /join workspace/i
    })
    fireEvent.click(joinButtons[joinButtons.length - 1])

    await waitFor(() => {
      expect(signupUser).toHaveBeenCalledWith(
        expect.objectContaining({
          invite_token: 'invite-token',
          invite_decision: 'join'
        })
      )
    })
  })

  it('allows creating own workspace from invite', async () => {
    ;(global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        invitation: {
          id: 'invite-id',
          workspace_id: 'workspace-id',
          email: 'invited@example.com',
          role: 'admin',
          token: 'invite-token',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          accepted_at: null,
          revoked_at: null,
          declined_at: null
        },
        expired: false,
        revoked: false,
        accepted: false,
        declined: false
      })
    })

    renderWithRouter('/signup?invite=invite-token')

    await waitFor(() => {
      expect(
        screen.getByText(/You're invited to join a workspace/i)
      ).toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByRole('button', { name: /create my own workspace/i })
    )

    fireEvent.change(screen.getByLabelText(/First Name/i), {
      target: { value: 'Alice' }
    })
    fireEvent.change(screen.getByLabelText(/Last Name/i), {
      target: { value: 'Smith' }
    })
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: 'Password123!' }
    })
    fireEvent.change(screen.getByLabelText(/Verify Password/i), {
      target: { value: 'Password123!' }
    })

    // Accept terms to enable submission
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(signupUser).toHaveBeenCalledWith(
        expect.objectContaining({
          invite_token: 'invite-token',
          invite_decision: 'decline'
        })
      )
    })
  })

  it('shows invalid invite message when preview fails', async () => {
    ;(global.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        invitation: {
          id: 'invite-id',
          workspace_id: 'workspace-id',
          email: 'invited@example.com',
          role: 'user',
          token: 'invite-token',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          accepted_at: null,
          revoked_at: null,
          declined_at: null
        },
        expired: true,
        revoked: false,
        accepted: false,
        declined: false
      })
    })

    renderWithRouter('/signup?invite=invite-token')

    await waitFor(() => {
      expect(
        screen.getByText(/Invalid or expired invite link/i)
      ).toBeInTheDocument()
    })
  })
})

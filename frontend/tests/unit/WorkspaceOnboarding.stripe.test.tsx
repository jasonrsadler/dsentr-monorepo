import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import WorkspaceOnboarding from '@/WorkspaceOnboarding'

// Mock useAuth to provide checkAuth
const authMocks = vi.hoisted(() => ({ useAuth: vi.fn() }))
vi.mock('@/stores/auth', () => authMocks)
const { useAuth } = authMocks

useAuth.mockImplementation((selector?: any) => {
  const base = { checkAuth: vi.fn() }
  return typeof selector === 'function' ? selector(base) : base
})

// Mock router navigate
vi.mock('react-router-dom', async (mod) => {
  const actual: any = await mod
  return {
    ...actual,
    useNavigate: () => vi.fn()
  }
})

describe('WorkspaceOnboarding – Stripe workspace upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // GET /api/workspaces/onboarding
    ;(global.fetch as any) = vi
      .fn()
      // GET /api/workspaces/onboarding
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          user: { first_name: 'A', last_name: 'B', plan: 'solo' },
          workflows: [],
          plan_options: [
            { tier: 'solo', name: 'Solo', description: 'x', price: 'Free' },
            {
              tier: 'workspace',
              name: 'Workspace',
              description: 'y',
              price: '$29/mo'
            }
          ]
        })
      })
      // GET /api/auth/csrf-token
      .mockResolvedValueOnce({ ok: true, text: async () => 'csrf-token' })
      // POST /api/workspaces/onboarding (checkout session)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          checkout_url: 'https://example.test/checkout'
        })
      })
  })

  it('starts checkout and shows redirecting step', async () => {
    const user = userEvent.setup()
    render(<WorkspaceOnboarding />)

    // Choose Workspace plan
    const ws = await screen.findByRole('button', { name: /Workspace/i })
    await user.click(ws)

    const nameInput = await screen.findByLabelText(/Workspace name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Acme')

    const complete = await screen.findByRole('button', {
      name: /Complete setup/i
    })
    await user.click(complete)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3))
    expect(
      await screen.findByRole('button', { name: /Redirecting/i })
    ).toBeInTheDocument()
  })
})

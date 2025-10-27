import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import PlanTab from '@/components/settings/tabs/PlanTab'

// Mock auth store to simulate an owner in a solo plan
const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  selectCurrentWorkspace: (state: any) => state.memberships?.[0] ?? null
}))

vi.mock('@/stores/auth', () => authMocks)

const { useAuth } = authMocks

const ownerMembership = {
  workspace: { id: 'ws-1', name: 'Acme', plan: 'solo' },
  role: 'owner'
}

useAuth.mockImplementation((selector?: any) => {
  const base = {
    user: { plan: 'solo' },
    memberships: [ownerMembership],
    currentWorkspaceId: 'ws-1',
    checkAuth: vi.fn()
  }
  return typeof selector === 'function' ? selector(base) : base
})

describe('PlanTab – Stripe workspace upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Basic fetch mock: onboarding (on mount) then checkout session creation
    global.fetch = vi
      .fn()
      // GET /api/workspaces/onboarding
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          user: { plan: 'solo' },
          memberships: [ownerMembership],
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
      } as any)
      // GET /api/auth/csrf-token
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'csrf-token'
      } as any)
      // POST /api/workspaces/plan
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          checkout_url: 'https://example.test/checkout'
        })
      } as any)
  })

  it('calls backend to create checkout session and shows redirecting state', async () => {
    const user = userEvent.setup()
    render(<PlanTab />)

    // Pick Workspace plan
    const wsOption = await screen.findByRole('button', { name: /Workspace/i })
    await user.click(wsOption)

    // Fill workspace name input appears
    const input = await screen.findByLabelText(/Workspace name/i)
    await user.clear(input)
    await user.type(input, 'Acme Team')

    // Submit
    const submit = await screen.findByRole('button', { name: /Update plan/i })
    await user.click(submit)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3))

    // Shows redirecting state on the submit button
    expect(
      await screen.findByRole('button', { name: /Redirecting/i })
    ).toBeInTheDocument()
  })
})

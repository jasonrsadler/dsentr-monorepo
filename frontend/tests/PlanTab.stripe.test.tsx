import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import PlanTab from '@/components/settings/tabs/PlanTab'

// Mock window.location.assign so Stripe redirect does not explode
Object.defineProperty(window, 'location', {
  writable: true,
  value: {
    ...window.location,
    assign: vi.fn()
  }
})

// Mock auth store to simulate an owner in a solo plan
const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  selectCurrentWorkspace: (s: any) => s.memberships?.[0] ?? null
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

// helper to produce Response-like objects
function mockResponse(body: any, mode: 'json' | 'text' = 'json') {
  return {
    ok: true,
    json: mode === 'json' ? async () => body : undefined,
    text: mode === 'text' ? async () => body : undefined
  }
}

describe('PlanTab – Stripe workspace upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/api/workspaces/onboarding')) {
        return mockResponse({
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
      }

      if (url.includes('/api/auth/csrf-token')) {
        return mockResponse('csrf-token', 'text')
      }

      if (url.includes('/api/workspaces/plan')) {
        return mockResponse({
          success: true,
          checkout_url: 'https://example.test/checkout',
          session_id: 'cs_test_123'
        })
      }

      // PlanTab often calls checkAuth() which triggers /api/auth/me
      if (url.includes('/api/auth/me')) {
        return mockResponse({
          success: true,
          user: { id: 'u1', email: 'tester@test.com' }
        })
      }

      throw new Error(`UNMOCKED FETCH CALL: ${url}`)
    })
  })

  it('calls backend to create checkout session and shows redirecting state', async () => {
    const user = userEvent.setup()
    render(<PlanTab />)

    const wsOption = await screen.findByRole('button', { name: /Workspace/i })
    await user.click(wsOption)

    const input = await screen.findByLabelText(/Workspace name/i)
    await user.clear(input)
    await user.type(input, 'Acme Team')

    const submit = await screen.findByRole('button', { name: /Update plan/i })
    await user.click(submit)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    // Look for "Redirecting…" on button
    const redirectingButton = await screen.findByRole('button', {
      name: /Redirecting/i
    })
    expect(redirectingButton).toBeInTheDocument()
  })
})

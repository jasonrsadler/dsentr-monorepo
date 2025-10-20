import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import IntegrationsTab from '../IntegrationsTab'

const mockWorkspace = {
  workspace: { id: 'ws-1', name: 'Acme Workspace', plan: 'workspace' },
  role: 'owner'
}

const authState = {
  user: { plan: 'workspace', role: 'admin' },
  memberships: [mockWorkspace],
  currentWorkspaceId: 'ws-1'
}

const fetchConnections = vi.fn()
const refreshProvider = vi.fn()
const disconnectProvider = vi.fn()
const promoteConnection = vi.fn()

vi.mock('@/lib/oauthApi', () => ({
  fetchConnections,
  refreshProvider,
  disconnectProvider,
  promoteConnection
}))

const useAuth = vi.fn((selector?: any) =>
  typeof selector === 'function' ? selector(authState) : authState
)

vi.mock('@/stores/auth', () => ({
  useAuth,
  selectCurrentWorkspace: (state: any) => state.memberships?.[0] ?? null
}))

describe('IntegrationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('promotes a personal connection to the workspace', async () => {
    fetchConnections
      .mockResolvedValueOnce({
        google: {
          personal: {
            scope: 'personal',
            id: 'google-personal',
            connected: true,
            accountEmail: 'owner@example.com',
            expiresAt: '2025-01-01T00:00:00.000Z',
            isShared: false
          },
          workspace: []
        },
        microsoft: {
          personal: {
            scope: 'personal',
            id: null,
            connected: false,
            accountEmail: undefined,
            expiresAt: undefined,
            isShared: false
          },
          workspace: []
        }
      })
      .mockResolvedValueOnce({
        google: {
          personal: {
            scope: 'personal',
            id: 'google-personal',
            connected: true,
            accountEmail: 'owner@example.com',
            expiresAt: '2025-01-01T00:00:00.000Z',
            isShared: true
          },
          workspace: [
            {
              scope: 'workspace',
              id: 'google-shared',
              connected: true,
              accountEmail: 'owner@example.com',
              expiresAt: '2025-01-01T00:00:00.000Z',
              workspaceId: 'ws-1',
              workspaceName: 'Acme Workspace',
              sharedByName: 'Owner Example',
              sharedByEmail: 'owner@example.com'
            }
          ]
        },
        microsoft: {
          personal: {
            scope: 'personal',
            id: null,
            connected: false,
            accountEmail: undefined,
            expiresAt: undefined,
            isShared: false
          },
          workspace: []
        }
      })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))

    const promoteButton = await screen.findByRole('button', {
      name: /Promote to Workspace/i
    })
    await user.click(promoteButton)

    const confirmButton = await screen.findByRole('button', {
      name: /Promote/i
    })
    await user.click(confirmButton)

    await waitFor(() => expect(promoteConnection).toHaveBeenCalledTimes(1))
    expect(promoteConnection).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      provider: 'google',
      connectionId: 'google-personal'
    })

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(2))

    expect(
      await screen.findByText(/Promoted to workspace/i)
    ).toBeInTheDocument()
    expect(screen.getByText('Workspace connections')).toBeInTheDocument()
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument()
  })
})

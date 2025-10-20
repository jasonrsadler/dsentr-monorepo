import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import IntegrationsTab from '../IntegrationsTab'

const mockWorkspace = {
  workspace: { id: 'ws-1', name: 'Acme Workspace', plan: 'workspace' },
  role: 'owner'
}

const authState = {
  user: {
    plan: 'workspace',
    role: 'admin',
    email: 'owner@example.com',
    first_name: 'Owner',
    last_name: 'Example'
  },
  memberships: [mockWorkspace],
  currentWorkspaceId: 'ws-1'
}

const oauthApiMocks = vi.hoisted(() => ({
  fetchConnections: vi.fn(),
  refreshProvider: vi.fn(),
  disconnectProvider: vi.fn(),
  promoteConnection: vi.fn(),
  unshareWorkspaceConnection: vi.fn(),
  setCachedConnections: vi.fn()
}))

vi.mock('@/lib/oauthApi', () => oauthApiMocks)

const {
  fetchConnections,
  refreshProvider,
  disconnectProvider,
  promoteConnection,
  unshareWorkspaceConnection,
  setCachedConnections
} = oauthApiMocks

const authStoreMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  selectCurrentWorkspace: (state: any) => state.memberships?.[0] ?? null
}))

vi.mock('@/stores/auth', () => authStoreMocks)

const { useAuth } = authStoreMocks

useAuth.mockImplementation((selector?: any) =>
  typeof selector === 'function' ? selector(authState) : authState
)

describe('IntegrationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setCachedConnections.mockImplementation(() => {})
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
            lastRefreshedAt: '2024-12-31T15:30:00.000Z',
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
            lastRefreshedAt: undefined,
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
            lastRefreshedAt: '2025-01-03T11:00:00.000Z',
            isShared: true
          },
          workspace: [
            {
              scope: 'workspace',
              id: 'google-shared',
              connected: true,
              accountEmail: 'owner@example.com',
              expiresAt: '2025-01-01T00:00:00.000Z',
              lastRefreshedAt: '2025-01-02T08:15:00.000Z',
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
            lastRefreshedAt: undefined,
            isShared: false
          },
          workspace: []
        }
      })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))

    const initialLastRefreshed = await screen.findAllByText(/Last refreshed/)
    expect(initialLastRefreshed.length).toBeGreaterThan(0)

    const promoteButton = await screen.findByRole('button', {
      name: /Promote to Workspace/i
    })
    await user.click(promoteButton)

    const confirmButton = await screen.findByRole('button', {
      name: /^Promote$/i
    })
    await user.click(confirmButton)

    await waitFor(() => expect(promoteConnection).toHaveBeenCalledTimes(1))
    expect(promoteConnection).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      provider: 'google',
      connectionId: 'google-personal'
    })

    expect(
      await screen.findByText(/Promoted to workspace/i)
    ).toBeInTheDocument()
    expect(screen.getAllByText('Workspace connections')[0]).toBeInTheDocument()
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText(/Last refreshed/)).toHaveLength(2)
    })
  })

  it('preserves existing token metadata when refresh response omits fields', async () => {
    fetchConnections.mockResolvedValueOnce({
      google: {
        personal: {
          scope: 'personal',
          id: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
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
          lastRefreshedAt: undefined,
          isShared: false
        },
        workspace: []
      }
    })
    refreshProvider.mockResolvedValueOnce({
      connected: true,
      accountEmail: 'owner@example.com',
      expiresAt: undefined,
      lastRefreshedAt: undefined
    })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))

    const refreshButton = await screen.findByRole('button', {
      name: /Refresh token/i
    })
    await user.click(refreshButton)

    await waitFor(() => expect(refreshProvider).toHaveBeenCalledWith('google'))
    await waitFor(() => expect(setCachedConnections).toHaveBeenCalled())

    const lastCall =
      setCachedConnections.mock.calls[
        setCachedConnections.mock.calls.length - 1
      ]
    expect(lastCall).toBeDefined()
    const snapshot = lastCall?.[0] as any

    expect(snapshot.google.personal.expiresAt).toBe('2025-01-01T00:00:00.000Z')
    expect(snapshot.google.personal.lastRefreshedAt).toBe(
      '2024-12-31T15:30:00.000Z'
    )

    expect(screen.getByText(/Token expires:/i)).toBeInTheDocument()
    expect(screen.getByText(/Last refreshed:/i)).toBeInTheDocument()
  })

  it('warns about breaking workflows when removing a workspace connection', async () => {
    fetchConnections.mockResolvedValueOnce({
      google: {
        personal: {
          scope: 'personal',
          id: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          isShared: true
        },
        workspace: [
          {
            scope: 'workspace',
            id: 'google-workspace-1',
            connected: true,
            accountEmail: 'owner@example.com',
            expiresAt: '2025-01-01T00:00:00.000Z',
            lastRefreshedAt: '2025-01-02T08:15:00.000Z',
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
          lastRefreshedAt: undefined,
          isShared: false
        },
        workspace: []
      }
    })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))

    const removeButton = await screen.findByRole('button', {
      name: /Remove from workspace/i
    })
    await user.click(removeButton)

    expect(
      await screen.findByText(
        /Workflows that rely on this connection may stop working/i
      )
    ).toBeInTheDocument()
  })

  it('removes shared workspace connections when disconnecting a personal credential', async () => {
    fetchConnections.mockResolvedValueOnce({
      google: {
        personal: {
          scope: 'personal',
          id: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          isShared: true
        },
        workspace: [
          {
            scope: 'workspace',
            id: 'google-workspace-1',
            connected: true,
            accountEmail: 'owner@example.com',
            expiresAt: '2025-01-01T00:00:00.000Z',
            lastRefreshedAt: '2025-01-02T08:15:00.000Z',
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
          lastRefreshedAt: undefined,
          isShared: false
        },
        workspace: []
      }
    })
    disconnectProvider.mockResolvedValueOnce(undefined)
    unshareWorkspaceConnection.mockResolvedValue(undefined)

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    const disconnectButton = await screen.findByRole('button', {
      name: /Disconnect/i
    })
    await user.click(disconnectButton)

    expect(
      await screen.findByText(/Existing workflows may stop working/i)
    ).toBeInTheDocument()
    expect(disconnectProvider).not.toHaveBeenCalled()

    const confirmButton = screen.getByRole('button', {
      name: /Remove credential/i
    })
    await user.click(confirmButton)

    await waitFor(() =>
      expect(unshareWorkspaceConnection).toHaveBeenCalledWith(
        'ws-1',
        'google-workspace-1'
      )
    )
    await waitFor(() =>
      expect(disconnectProvider).toHaveBeenCalledWith('google')
    )

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Connect/i })).toHaveLength(
        2
      )
    })
  })
})

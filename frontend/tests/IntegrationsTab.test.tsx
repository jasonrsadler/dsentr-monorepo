import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import IntegrationsTab from '@/components/settings/tabs/IntegrationsTab'

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
  setCachedConnections: vi.fn(),
  markProviderRevoked: vi.fn()
}))

vi.mock('@/lib/oauthApi', () => oauthApiMocks)

const {
  fetchConnections,
  refreshProvider,
  disconnectProvider,
  promoteConnection,
  unshareWorkspaceConnection,
  setCachedConnections,
  markProviderRevoked
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
    promoteConnection.mockResolvedValue({
      workspaceConnectionId: 'workspace-generated-id',
      createdBy: 'user-id'
    })
    unshareWorkspaceConnection.mockResolvedValue(undefined)
    disconnectProvider.mockResolvedValue(undefined)
    refreshProvider.mockResolvedValue(undefined as any)
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
            requiresReconnect: false,
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
            requiresReconnect: false,
            isShared: false
          },
          workspace: []
        },
        slack: {
          personal: {
            scope: 'personal',
            id: null,
            connected: false,
            accountEmail: undefined,
            expiresAt: undefined,
            lastRefreshedAt: undefined,
            requiresReconnect: false,
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
            requiresReconnect: false,
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
              sharedByEmail: 'owner@example.com',
              requiresReconnect: false
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
            requiresReconnect: false,
            isShared: false
          },
          workspace: []
        },
        slack: {
          personal: {
            scope: 'personal',
            id: null,
            connected: false,
            accountEmail: undefined,
            expiresAt: undefined,
            lastRefreshedAt: undefined,
            requiresReconnect: false,
            isShared: false
          },
          workspace: []
        }
      })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    expect(
      await screen.findByRole('button', { name: /Connect Slack/i })
    ).toBeInTheDocument()

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

    const lastCacheCall =
      setCachedConnections.mock.calls[
        setCachedConnections.mock.calls.length - 1
      ]
    expect(lastCacheCall?.[1]).toEqual({ workspaceId: 'ws-1' })
    const cachedSnapshot = lastCacheCall?.[0] as any
    const workspaceEntries = cachedSnapshot.google.workspace
    const lastWorkspaceEntry = workspaceEntries[workspaceEntries.length - 1]
    expect(lastWorkspaceEntry.id).toBe('workspace-generated-id')

    expect(
      await screen.findByText(/Promoted to workspace/i)
    ).toBeInTheDocument()
    expect(screen.getAllByText('Workspace connections')[0]).toBeInTheDocument()
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText(/Last refreshed/)).toHaveLength(2)
    })
  })

  it('removes a newly promoted workspace connection without refreshing', async () => {
    fetchConnections.mockResolvedValueOnce({
      google: {
        personal: {
          scope: 'personal',
          id: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          requiresReconnect: false,
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
          requiresReconnect: false,
          isShared: false
        },
        workspace: []
      },
      slack: {
        personal: {
          scope: 'personal',
          id: null,
          connected: false,
          accountEmail: undefined,
          expiresAt: undefined,
          lastRefreshedAt: undefined,
          requiresReconnect: false,
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

    const confirmPromote = await screen.findByRole('button', {
      name: /^Promote$/i
    })
    await user.click(confirmPromote)

    await waitFor(() => expect(promoteConnection).toHaveBeenCalledTimes(1))

    const removeButton = await screen.findByRole('button', {
      name: /Remove from workspace/i
    })
    await user.click(removeButton)

    await screen.findByText(/Remove Workspace Connection/i)
    const confirmButtons = await screen.findAllByRole('button', {
      name: /^Remove$/i
    })
    const confirmRemove = confirmButtons[confirmButtons.length - 1]
    await user.click(confirmRemove)

    await waitFor(() =>
      expect(unshareWorkspaceConnection).toHaveBeenCalledWith(
        'ws-1',
        'workspace-generated-id'
      )
    )
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
          requiresReconnect: false,
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
          requiresReconnect: false,
          isShared: false
        },
        workspace: []
      },
      slack: {
        personal: {
          scope: 'personal',
          id: null,
          connected: false,
          accountEmail: undefined,
          expiresAt: undefined,
          lastRefreshedAt: undefined,
          requiresReconnect: false,
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
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

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
    expect(lastCall?.[1]).toEqual({ workspaceId: 'ws-1' })

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
          requiresReconnect: false,
          isShared: false
        },
        workspace: []
      },
      slack: {
        personal: {
          scope: 'personal',
          id: null,
          connected: false,
          accountEmail: undefined,
          expiresAt: undefined,
          lastRefreshedAt: undefined,
          requiresReconnect: false,
          isShared: false
        },
        workspace: []
      }
    })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

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
      },
      slack: {
        personal: {
          scope: 'personal',
          id: null,
          connected: false,
          accountEmail: undefined,
          expiresAt: undefined,
          lastRefreshedAt: undefined,
          requiresReconnect: false,
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
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
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
        3
      )
    })
  })

  it('displays a reconnect warning when the personal credential is revoked', async () => {
    fetchConnections.mockResolvedValueOnce({
      google: {
        personal: {
          scope: 'personal',
          id: 'google-personal',
          connected: false,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          requiresReconnect: true,
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
          requiresReconnect: false,
          isShared: false
        },
        workspace: []
      },
      slack: {
        personal: {
          scope: 'personal',
          id: null,
          connected: false,
          accountEmail: undefined,
          expiresAt: undefined,
          lastRefreshedAt: undefined,
          requiresReconnect: false,
          isShared: false
        },
        workspace: []
      }
    })

    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    expect(
      await screen.findByText(/connection was revoked/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /connect google/i })
    ).toBeEnabled()
  })

  it('clears provider state when refresh indicates revocation', async () => {
    fetchConnections.mockResolvedValueOnce({
      google: {
        personal: {
          scope: 'personal',
          id: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          requiresReconnect: false,
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
          requiresReconnect: false,
          isShared: false
        },
        workspace: []
      },
      slack: {
        personal: {
          scope: 'personal',
          id: null,
          connected: false,
          accountEmail: undefined,
          expiresAt: undefined,
          lastRefreshedAt: undefined,
          requiresReconnect: false,
          isShared: false
        },
        workspace: []
      }
    })
    const revokedError = new Error('revoked') as Error & {
      requiresReconnect: boolean
    }
    revokedError.requiresReconnect = true
    refreshProvider.mockRejectedValueOnce(revokedError)

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    const refreshButton = await screen.findByRole('button', {
      name: /refresh token/i
    })
    await user.click(refreshButton)

    await waitFor(() => expect(refreshProvider).toHaveBeenCalledTimes(1))
    expect(markProviderRevoked).toHaveBeenCalledWith('google')

    expect(
      await screen.findByText(/reconnect to restore access/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /connect google/i })
    ).toBeEnabled()
  })
})

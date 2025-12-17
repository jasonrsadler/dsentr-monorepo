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

async function expandProviderSections(
  user: ReturnType<typeof userEvent.setup>
) {
  for (const name of ['Google', 'Microsoft', 'Slack', 'Asana']) {
    const toggle = await screen.findByRole('button', {
      name: new RegExp(`${name}`, 'i')
    })
    if (toggle.getAttribute('aria-expanded') === 'false') {
      await user.click(toggle)
    }
  }
}

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
    refreshProvider.mockResolvedValue({
      connected: true,
      accountEmail: undefined,
      expiresAt: undefined,
      lastRefreshedAt: undefined
    } as any)
  })

  it('promotes a personal connection to the workspace', async () => {
    fetchConnections
      .mockResolvedValueOnce({
        personal: [
          {
            scope: 'personal',
            provider: 'google',
            id: 'google-personal',
            connectionId: 'google-personal',
            connected: true,
            accountEmail: 'owner@example.com',
            expiresAt: '2025-01-01T00:00:00.000Z',
            lastRefreshedAt: '2024-12-31T15:30:00.000Z',
            requiresReconnect: false,
            isShared: false
          }
        ],
        workspace: []
      })
      .mockResolvedValueOnce({
        personal: [
          {
            scope: 'personal',
            provider: 'google',
            id: 'google-personal',
            connectionId: 'google-personal',
            connected: true,
            accountEmail: 'owner@example.com',
            expiresAt: '2025-01-01T00:00:00.000Z',
            lastRefreshedAt: '2025-01-03T11:00:00.000Z',
            requiresReconnect: false,
            isShared: true
          }
        ],
        workspace: [
          {
            scope: 'workspace',
            provider: 'google',
            id: 'google-shared',
            workspaceConnectionId: 'google-shared',
            connectionId: 'google-personal',
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
      })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    expect(
      await screen.findByRole('button', { name: /Connect Slack/i })
    ).toBeInTheDocument()

    const initialLastRefreshed = await screen.findAllByText(/Last refreshed/)
    expect(initialLastRefreshed.length).toBeGreaterThan(0)
    expect(
      await screen.findByText(/Connection ID: google-personal/i)
    ).toBeInTheDocument()

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
    const workspaceEntries = cachedSnapshot.workspace.filter(
      (w: any) => w.provider === 'google'
    )
    const lastWorkspaceEntry = workspaceEntries[workspaceEntries.length - 1]
    expect(lastWorkspaceEntry.id).toBe('workspace-generated-id')
    expect(lastWorkspaceEntry.connectionId).toBe('google-personal')

    expect(
      await screen.findByText(/Shared with workspace/i)
    ).toBeInTheDocument()
    expect(screen.getAllByText('Workspace connections')[0]).toBeInTheDocument()
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument()
    expect(
      await screen.findByText(/Workspace connection ID:/i)
    ).toBeInTheDocument()

    expect(
      await screen.findByText(/Workspace connection ID:/i)
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText(/Last refreshed/)).toHaveLength(2)
    })
  })

  it('removes a newly promoted workspace connection without refreshing', async () => {
    fetchConnections.mockResolvedValueOnce({
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-personal',
          connectionId: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          requiresReconnect: false,
          isShared: false
        }
      ],
      workspace: []
    })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await expandProviderSections(user)
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
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-personal',
          connectionId: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          requiresReconnect: false,
          isShared: false
        }
      ],
      workspace: []
    })
    refreshProvider.mockResolvedValueOnce({
      connected: true,
      accountEmail: 'owner@example.com',
      expiresAt: undefined,
      lastRefreshedAt: undefined
    })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    const refreshButton = await screen.findByRole('button', {
      name: /Refresh/i
    })
    await user.click(refreshButton)

    await waitFor(() =>
      expect(refreshProvider).toHaveBeenCalledWith('google', 'google-personal')
    )
    await waitFor(() => expect(setCachedConnections).toHaveBeenCalled())

    const lastCall =
      setCachedConnections.mock.calls[
        setCachedConnections.mock.calls.length - 1
      ]
    expect(lastCall).toBeDefined()
    const snapshot = lastCall?.[0] as any
    expect(lastCall?.[1]).toEqual({ workspaceId: 'ws-1' })

    const personalGoogle = snapshot.personal.find(
      (p: any) => p.provider === 'google'
    )
    expect(personalGoogle.expiresAt).toBe('2025-01-01T00:00:00.000Z')
    expect(personalGoogle.lastRefreshedAt).toBe('2024-12-31T15:30:00.000Z')

    expect(screen.getByText(/Token expires/i)).toBeInTheDocument()
    expect(screen.getByText(/Last refreshed/i)).toBeInTheDocument()
  })

  it('warns about breaking workflows when removing a workspace connection', async () => {
    fetchConnections.mockResolvedValueOnce({
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-personal',
          connectionId: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          isShared: true
        }
      ],
      workspace: [
        {
          scope: 'workspace',
          provider: 'google',
          id: 'google-workspace-1',
          workspaceConnectionId: 'google-workspace-1',
          connectionId: 'google-personal',
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
    })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await expandProviderSections(user)
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
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-personal',
          connectionId: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          isShared: true,
          requiresReconnect: false
        }
      ],
      workspace: [
        {
          scope: 'workspace',
          provider: 'google',
          id: 'google-workspace-1',
          workspaceConnectionId: 'google-workspace-1',
          connectionId: 'google-personal',
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
    })
    disconnectProvider.mockResolvedValueOnce(undefined)
    unshareWorkspaceConnection.mockResolvedValue(undefined)

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await expandProviderSections(user)
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
      expect(disconnectProvider).toHaveBeenCalledWith(
        'google',
        'google-personal'
      )
    )

    expect(
      await screen.findByRole('button', { name: /Connect Google/i })
    ).toBeInTheDocument()
  })

  it('displays a reconnect warning when the personal credential is revoked', async () => {
    fetchConnections.mockResolvedValueOnce({
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-personal',
          connectionId: 'google-personal',
          connected: false,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          requiresReconnect: true,
          isShared: false
        }
      ],
      workspace: []
    })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    expect(
      await screen.findByText(/personal connections were revoked/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /connect google/i })
    ).toBeEnabled()
  })

  it('clears provider state when refresh indicates revocation', async () => {
    fetchConnections.mockResolvedValueOnce({
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-personal',
          connectionId: 'google-personal',
          connected: true,
          accountEmail: 'owner@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          lastRefreshedAt: '2024-12-31T15:30:00.000Z',
          requiresReconnect: false,
          isShared: false
        }
      ],
      workspace: []
    })
    const revokedError = new Error('revoked') as Error & {
      requiresReconnect: boolean
    }
    revokedError.requiresReconnect = true
    refreshProvider.mockRejectedValueOnce(revokedError)

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    const refreshButton = await screen.findByRole('button', {
      name: /refresh/i
    })
    await user.click(refreshButton)

    await waitFor(() => expect(refreshProvider).toHaveBeenCalledTimes(1))
    expect(markProviderRevoked).not.toHaveBeenCalled()

    expect(
      await screen.findByText(/personal connections were revoked/i)
    ).toBeInTheDocument()
    const lastCache =
      setCachedConnections.mock.calls[
        setCachedConnections.mock.calls.length - 1
      ]
    const snapshot = lastCache?.[0] as any
    expect(lastCache?.[1]).toEqual({ workspaceId: 'ws-1' })
    expect(snapshot.personal[0].requiresReconnect).toBe(true)

    expect(
      screen.getByRole('button', { name: /connect google/i })
    ).toBeEnabled()
  })

  it('renders multiple connections per provider and filters providers', async () => {
    fetchConnections.mockResolvedValueOnce({
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-1',
          connectionId: 'google-1',
          connected: true,
          accountEmail: 'one@example.com',
          requiresReconnect: false,
          isShared: false
        },
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-2',
          connectionId: 'google-2',
          connected: true,
          accountEmail: 'two@example.com',
          requiresReconnect: false,
          isShared: false
        }
      ],
      workspace: [
        {
          scope: 'workspace',
          provider: 'slack',
          id: 'slack-workspace-1',
          workspaceConnectionId: 'slack-workspace-1',
          connectionId: 'slack-conn-1',
          connected: true,
          accountEmail: 'slack@example.com',
          workspaceId: 'ws-1',
          workspaceName: 'Acme Workspace',
          sharedByName: 'Owner Example',
          sharedByEmail: 'owner@example.com',
          requiresReconnect: false
        }
      ]
    })

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await expandProviderSections(user)
    expect(
      await screen.findByText(/Connection ID: google-1/i)
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/Connection ID: google-2/i)
    ).toBeInTheDocument()

    const searchInput = screen.getByRole('searchbox', {
      name: /search providers/i
    })
    await user.clear(searchInput)
    await user.type(searchInput, 'Slack')

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Google/i })
      ).not.toBeInTheDocument()
    })
    expect(
      screen.getByRole('button', { name: /Slack.*workspace/i })
    ).toBeInTheDocument()
  })
})

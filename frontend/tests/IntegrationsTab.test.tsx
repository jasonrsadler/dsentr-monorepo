import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

// Helper function to wait for providers to be rendered
async function waitForProviders() {
  await waitFor(
    () => {
      expect(screen.getByTestId('provider-google')).toBeInTheDocument()
      expect(screen.getByTestId('provider-microsoft')).toBeInTheDocument()
      expect(screen.getByTestId('provider-slack')).toBeInTheDocument()
      expect(screen.getByTestId('provider-asana')).toBeInTheDocument()
    },
    { timeout: 3000 }
  )
}

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
  markProviderRevoked: vi.fn(),
  startSlackPersonalAuthorization: vi.fn(),
  SLACK_PERSONAL_AUTHORIZE_LABEL: 'Authorize Slack for yourself',
  SLACK_PERSONAL_REAUTHORIZE_LABEL: 'Reauthorize Slack',
  SLACK_PERSONAL_AUTHORIZED_LABEL: 'Personal Slack authorized',
  SLACK_PERSONAL_AUTHORIZED_HINT: 'Slack is authorized to post as you',
  SLACK_PERSONAL_AUTH_REQUIRED: 'Authorize Slack for yourself to post as you.'
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

    await waitForProviders()
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

    const googleSection = screen.getByTestId('provider-google')
    const promoteButton = await within(googleSection).findByRole('button', {
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

    await waitForProviders()
    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))

    const promoteButton = await within(
      screen.getByTestId('provider-google')
    ).findByRole('button', {
      name: /Promote to Workspace/i
    })
    await user.click(promoteButton)

    const confirmPromote = await within(document.body).findByRole('button', {
      name: /^Promote$/i
    })
    await user.click(confirmPromote)

    await waitFor(() => expect(promoteConnection).toHaveBeenCalledTimes(1))

    const googleSection = screen.getByTestId('provider-google')
    const workspaceHeader =
      await within(googleSection).findByText('Acme Workspace')
    const workspaceSection =
      workspaceHeader.closest('li') || workspaceHeader.parentElement
    const removeButton = within(workspaceSection as HTMLElement).getByRole(
      'button',
      {
        name: /Remove from workspace/i
      }
    )
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

    await waitForProviders()
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

    await waitForProviders()
    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    const googleSection = screen.getByTestId('provider-google')
    const workspaceHeader =
      await within(googleSection).findByText('Acme Workspace')
    const workspaceSection =
      workspaceHeader.closest('li') || workspaceHeader.parentElement
    const removeButton = within(workspaceSection as HTMLElement).getByRole(
      'button',
      {
        name: /Remove from workspace/i
      }
    )
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

    await waitForProviders()
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

    await waitForProviders()
    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    const googleSection = screen.getByTestId('provider-google')
    expect(
      within(googleSection).getByRole('button', { name: /connect google/i })
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

    await waitForProviders()
    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))
    expect(fetchConnections).toHaveBeenCalledWith({ workspaceId: 'ws-1' })

    const provider = screen.getByTestId('provider-google')
    const refreshButton = await within(provider).findByRole('button', {
      name: /refresh/i
    })
    await user.click(refreshButton)

    await waitFor(() => expect(refreshProvider).toHaveBeenCalledTimes(1))
    expect(markProviderRevoked).not.toHaveBeenCalled()

    const providerEl = screen.getByTestId('provider-google')
    const reconnects2 =
      await within(providerEl).findAllByText(/Reconnect required/i)
    expect(reconnects2.length).toBeGreaterThanOrEqual(1)
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

  it('disables refresh and disconnect when no connection ID is available', async () => {
    fetchConnections.mockResolvedValueOnce({
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: null,
          connectionId: null,
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

    await waitForProviders()
    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))

    const googleSectionEl = screen.getByTestId('provider-google')
    const personalEntry =
      await within(googleSectionEl).findByText(/owner@example.com/i)
    const personalItem = personalEntry.closest('li') as HTMLElement
    const buttons = personalItem.getElementsByTagName('button')
    const refreshButton = buttons[0] as HTMLButtonElement
    const disconnectButton = buttons[1] as HTMLButtonElement

    expect(refreshButton).toBeDisabled()
    expect(disconnectButton).toBeDisabled()
  })

  it('refreshes and disconnects using explicit connection IDs', async () => {
    fetchConnections.mockResolvedValueOnce({
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-1',
          connectionId: 'google-1',
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

    await waitForProviders()
    await expandProviderSections(user)
    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))

    const googleSectionEl = screen.getByTestId('provider-google')
    const personalEntry =
      await within(googleSectionEl).findByText(/owner@example.com/i)
    const personalItem = personalEntry.closest('li') as HTMLElement
    const refreshButton = within(personalItem).getByRole('button', {
      name: /^Refresh$/i
    }) as HTMLButtonElement
    await user.click(refreshButton)

    await waitFor(() => expect(refreshProvider).toHaveBeenCalled())
    expect(refreshProvider).toHaveBeenCalledWith('google', expect.any(String))

    const disconnectButton = within(personalItem).getByRole('button', {
      name: /^Disconnect$/i
    })
    await user.click(disconnectButton)

    await waitFor(() => expect(disconnectProvider).toHaveBeenCalled())
    expect(disconnectProvider).toHaveBeenCalledWith(
      'google',
      expect.any(String)
    )
  })

  it('surfaces missing connection ID errors from the API', async () => {
    fetchConnections.mockResolvedValueOnce({
      personal: [
        {
          scope: 'personal',
          provider: 'google',
          id: 'google-1',
          connectionId: 'google-1',
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
    refreshProvider.mockRejectedValueOnce(
      new Error('connectionId is required to refresh provider tokens')
    )

    const user = userEvent.setup()
    render(<IntegrationsTab />)

    await waitForProviders()
    await expandProviderSections(user)
    const refreshButton = await screen.findByRole('button', {
      name: /refresh/i
    })
    await user.click(refreshButton)

    await waitFor(() => expect(refreshProvider).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(/connectionid is required/i)
    ).toBeInTheDocument()
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

    await waitForProviders()
    await expandProviderSections(user)

    // Google provider renders with multiple connections
    const googleSection = screen.getByTestId('provider-google')
    const googleItems = within(googleSection).getAllByRole('listitem')
    expect(googleItems.length).toBeGreaterThanOrEqual(2)

    // Filter providers
    const searchInput = screen.getByRole('searchbox', {
      name: /search providers/i
    })

    await user.clear(searchInput)
    await user.type(searchInput, 'Slack')

    // Google is filtered out
    await waitFor(() => {
      expect(screen.queryByTestId('provider-google')).not.toBeInTheDocument()
    })

    // Slack remains visible
    expect(screen.getByTestId('provider-slack')).toBeInTheDocument()
  })

  describe('Slack workspace-first behavior', () => {
    it('renders Install Slack to workspace when NO workspace connection exists', async () => {
      fetchConnections.mockResolvedValueOnce({
        personal: [
          {
            scope: 'personal',
            provider: 'slack',
            id: 'slack-personal-1',
            connectionId: 'slack-personal-1',
            connected: true,
            accountEmail: 'user@example.com',
            requiresReconnect: false,
            isShared: false
          }
        ],
        workspace: []
      })

      const user = userEvent.setup()
      render(<IntegrationsTab />)

      await waitForProviders()
      await expandProviderSections(user)

      const slackSection = screen.getByTestId('provider-slack')

      // Assert exact button text for workspace install
      expect(
        within(slackSection).getByText('Install Slack to workspace')
      ).toBeInTheDocument()

      // Assert NO personal authorization button
      expect(
        within(slackSection).queryByText('Authorize Slack for yourself')
      ).not.toBeInTheDocument()

      // Assert NO promotion controls (Slack should never have these)
      expect(
        within(slackSection).queryByRole('button', {
          name: /promote to workspace/i
        })
      ).not.toBeInTheDocument()

      // Assert personal connections are NOT displayed in top-level list
      expect(
        within(slackSection).queryByText(/user@example.com/i)
      ).not.toBeInTheDocument()
      expect(
        within(slackSection).queryByText(/Connection ID: slack-personal-1/i)
      ).not.toBeInTheDocument()
    })

    it('renders Authorize Slack for yourself when workspace connection exists', async () => {
      fetchConnections.mockResolvedValueOnce({
        personal: [],
        workspace: [
          {
            scope: 'workspace',
            provider: 'slack',
            id: 'slack-workspace-1',
            workspaceConnectionId: 'slack-workspace-1',
            connectionId: 'slack-conn-1',
            connected: true,
            accountEmail: 'workspace-bot@example.com',
            workspaceId: 'ws-1',
            workspaceName: 'Acme Workspace',
            sharedByName: 'Owner Example',
            sharedByEmail: 'owner@example.com',
            requiresReconnect: false
          }
        ],
        slackPersonalAuth: {
          hasPersonalAuth: false
        }
      })

      const user = userEvent.setup()
      render(<IntegrationsTab />)

      await waitForProviders()
      await expandProviderSections(user)

      const slackSection = screen.getByTestId('provider-slack')

      // Assert exact button text for personal authorization
      expect(
        within(slackSection).getByText('Authorize Slack for yourself')
      ).toBeInTheDocument()

      // Assert NO workspace install button
      expect(
        within(slackSection).queryByText('Install Slack to workspace')
      ).not.toBeInTheDocument()

      // Assert NO promotion controls
      expect(
        within(slackSection).queryByRole('button', {
          name: /promote to workspace/i
        })
      ).not.toBeInTheDocument()
    })

    it('renders Slack workspace entry with proper identity and linking', async () => {
      fetchConnections.mockResolvedValueOnce({
        personal: [
          {
            scope: 'personal',
            provider: 'slack',
            id: 'slack-personal-1',
            connectionId: 'slack-personal-1',
            workspaceConnectionId: 'slack-workspace-1',
            connected: true,
            accountEmail: 'owner@example.com',
            requiresReconnect: false,
            isShared: false
          },
          {
            scope: 'personal',
            provider: 'slack',
            id: 'slack-personal-2',
            connectionId: 'slack-personal-2',
            workspaceConnectionId: 'slack-workspace-1',
            connected: true,
            accountEmail: 'teammate@example.com',
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
            accountEmail: 'workspace-bot@example.com',
            workspaceId: 'ws-1',
            workspaceName: 'Acme Workspace',
            sharedByName: 'Owner Example',
            sharedByEmail: 'owner@example.com',
            requiresReconnect: false
          }
        ],
        slackPersonalAuth: {
          hasPersonalAuth: true,
          personalAuthConnectedAt: '2025-01-01T00:00:00.000Z'
        }
      })

      const user = userEvent.setup()
      render(<IntegrationsTab />)

      await waitForProviders()
      await expandProviderSections(user)

      const slackSection = screen.getByTestId('provider-slack')

      // Assert workspace entry renders workspace name
      expect(
        within(slackSection).getByText('Acme Workspace')
      ).toBeInTheDocument()

      // Assert workspace entry renders workspace connection ID
      expect(
        within(slackSection).getByText(
          'Workspace connection ID: slack-workspace-1'
        )
      ).toBeInTheDocument()

      // Assert personal Slack authorization status is visible
      expect(
        within(slackSection).getByText('Personal Slack authorized')
      ).toBeInTheDocument()
      expect(
        within(slackSection).getByText('Slack is authorized to post as you')
      ).toBeInTheDocument()

      // Assert personal connections still NOT in top-level personal list
      expect(
        within(slackSection).queryByText(/Your connections/i)
      ).toBeInTheDocument()
      const personalConnectionsSection = within(slackSection)
        .queryByText(/Your connections/i)
        ?.closest('div')
      expect(personalConnectionsSection).toBeInTheDocument()

      // Slack personal auth hint replaces the empty personal list
      expect(
        within(slackSection).getByText('Slack is authorized to post as you')
      ).toBeInTheDocument()
    })

    it('never renders promotion controls for Slack provider', async () => {
      fetchConnections.mockResolvedValueOnce({
        personal: [
          {
            scope: 'personal',
            provider: 'slack',
            id: 'slack-personal',
            connectionId: 'slack-personal',
            connected: true,
            accountEmail: 'slack@example.com',
            requiresReconnect: false,
            isShared: false
          }
        ],
        workspace: []
      })

      const user = userEvent.setup()
      render(<IntegrationsTab />)

      await waitForProviders()
      await expandProviderSections(user)

      const slackSection = screen.getByTestId('provider-slack')

      // Slack should NEVER have promotion controls, even with personal connections
      expect(
        within(slackSection).queryByText('Promote to workspace')
      ).not.toBeInTheDocument()

      // Verify there are no promote buttons anywhere in the Slack section
      const slackPromoteButtons = within(slackSection).queryAllByText(
        'Promote to workspace'
      )
      expect(slackPromoteButtons).toHaveLength(0)
    })

    it('renders Slack workspace connection indicator when workspace exists', async () => {
      fetchConnections.mockResolvedValueOnce({
        personal: [],
        workspace: [
          {
            scope: 'workspace',
            provider: 'slack',
            id: 'slack-workspace-1',
            workspaceConnectionId: 'slack-workspace-1',
            connectionId: 'slack-conn-1',
            connected: true,
            accountEmail: 'workspace-bot@example.com',
            workspaceId: 'ws-1',
            workspaceName: 'Acme Workspace',
            sharedByName: 'Owner Example',
            sharedByEmail: 'owner@example.com',
            requiresReconnect: false,
            hasIncomingWebhook: true
          }
        ]
      })

      const user = userEvent.setup()
      render(<IntegrationsTab />)

      await waitForProviders()
      await expandProviderSections(user)

      const slackSection = screen.getByTestId('provider-slack')

      // Assert Slack connected to workspace indicator
      expect(
        within(slackSection).getByText('Slack connected to workspace')
      ).toBeInTheDocument()

      // Assert posting method shows webhook
      expect(
        within(slackSection).getByText('Posting method: Incoming Webhook')
      ).toBeInTheDocument()
    })
  })
})

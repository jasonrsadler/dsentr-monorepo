import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import SheetsAction from '../SheetsAction'
import { updateCachedConnections } from '@/lib/oauthApi'
import { useAuth } from '@/stores/auth'

const createJsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

const googlePersonalPayload = {
  id: 'google-personal',
  provider: 'google' as const,
  accountEmail: 'owner@example.com',
  expiresAt: '2025-01-01T00:00:00.000Z',
  isShared: false,
  lastRefreshedAt: null,
  requiresReconnect: false
}

const googleWorkspacePayload = {
  id: 'google-workspace',
  provider: 'google' as const,
  accountEmail: 'ops@example.com',
  expiresAt: '2025-01-01T00:00:00.000Z',
  workspaceId: 'ws-1',
  workspaceName: 'Operations',
  sharedByName: 'Team Admin',
  sharedByEmail: 'admin@example.com',
  lastRefreshedAt: null,
  requiresReconnect: false
}

const buildGoogleConnections = (includeWorkspace: boolean) => ({
  personal: {
    scope: 'personal' as const,
    id: 'google-personal',
    connected: true,
    accountEmail: 'owner@example.com',
    expiresAt: '2025-01-01T00:00:00.000Z',
    lastRefreshedAt: undefined,
    requiresReconnect: false,
    isShared: includeWorkspace
  },
  workspace: includeWorkspace
    ? [
        {
          scope: 'workspace' as const,
          id: 'google-workspace',
          connected: true,
          accountEmail: 'ops@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          workspaceId: 'ws-1',
          workspaceName: 'Operations',
          sharedByName: 'Team Admin',
          sharedByEmail: 'admin@example.com',
          requiresReconnect: false
        }
      ]
    : []
})

const buildEmptyConnections = () => ({
  personal: {
    scope: 'personal' as const,
    id: null,
    connected: false,
    accountEmail: undefined,
    expiresAt: undefined,
    lastRefreshedAt: undefined,
    requiresReconnect: false,
    isShared: false
  },
  workspace: [] as never[]
})

const buildConnectionMap = (includeWorkspace: boolean) => ({
  google: (() => {
    const google = buildGoogleConnections(includeWorkspace)
    return {
      personal: { ...google.personal },
      workspace: google.workspace.map((entry) => ({ ...entry }))
    }
  })(),
  microsoft: (() => {
    const microsoft = buildEmptyConnections()
    return {
      personal: { ...microsoft.personal },
      workspace: microsoft.workspace.map((entry) => ({ ...entry }))
    }
  })()
})

const initialAuthState = useAuth.getState()

const workspaceMembership = {
  workspace: {
    id: 'ws-1',
    name: 'Acme Workspace',
    plan: 'workspace',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    created_by: 'owner',
    owner_id: 'owner'
  },
  role: 'owner' as const
}

describe('SheetsAction', () => {
  const baseArgs = {
    spreadsheetId: '',
    worksheet: '',
    columns: [],
    accountEmail: '',
    oauthConnectionScope: '',
    oauthConnectionId: '',
    dirty: false,
    setParams: vi.fn(),
    setDirty: vi.fn()
  }

  beforeEach(() => {
    act(() => {
      useAuth.setState((state) => ({
        ...state,
        memberships: [workspaceMembership],
        currentWorkspaceId: workspaceMembership.workspace.id
      }))
    })
    updateCachedConnections(() => null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    updateCachedConnections(() => null)
    act(() => {
      useAuth.setState(initialAuthState, true)
    })
  })

  it('renders grouped connection options', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [googlePersonalPayload],
        workspace: [googleWorkspacePayload]
      })
    )

    const user = userEvent.setup()
    render(<SheetsAction args={{ ...baseArgs }} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const dropdownButton = await screen.findByRole('button', {
      name: /owner@example.com/i
    })
    await user.click(dropdownButton)

    expect(await screen.findByText('Your connections')).toBeInTheDocument()
    expect(screen.getByText('Workspace connections')).toBeInTheDocument()
  })

  it('shows workspace credential notice when selected', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [googlePersonalPayload],
        workspace: [googleWorkspacePayload]
      })
    )

    render(
      <SheetsAction
        args={{
          ...baseArgs,
          accountEmail: 'ops@example.com',
          oauthConnectionScope: 'workspace',
          oauthConnectionId: 'google-workspace'
        }}
      />
    )

    expect(await screen.findByText(/workspace credential/i)).toBeInTheDocument()
  })

  it('clears workspace selections when the shared credential is removed while open', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [googlePersonalPayload],
        workspace: [googleWorkspacePayload]
      })
    )

    render(
      <SheetsAction
        args={{
          ...baseArgs,
          accountEmail: 'ops@example.com',
          oauthConnectionScope: 'workspace',
          oauthConnectionId: 'google-workspace'
        }}
      />
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /workspace credential/i })
      ).toBeInTheDocument()
    )

    await act(async () => {
      updateCachedConnections(() => buildConnectionMap(false))
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Select Google connection' })
      ).toBeInTheDocument()
    )
  })

  it('drops revoked personal credentials from the selection', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [
          {
            ...googlePersonalPayload,
            requiresReconnect: true
          }
        ],
        workspace: []
      })
    )

    render(
      <SheetsAction
        args={{
          ...baseArgs,
          accountEmail: 'owner@example.com',
          oauthConnectionScope: 'personal',
          oauthConnectionId: 'google-personal'
        }}
      />
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Select Google connection' })
      ).toBeInTheDocument()
    )
  })

  it('adds workspace connections without refetching when promoted elsewhere', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [googlePersonalPayload],
        workspace: []
      })
    )

    const user = userEvent.setup()
    render(<SheetsAction args={{ ...baseArgs }} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const dropdownButton = await screen.findByRole('button', {
      name: /owner@example.com/i
    })
    await user.click(dropdownButton)

    expect(screen.queryByText('Workspace connections')).not.toBeInTheDocument()

    await act(async () => {
      updateCachedConnections(() => buildConnectionMap(true))
    })

    await user.click(dropdownButton)
    expect(await screen.findByText('Workspace connections')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

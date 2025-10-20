import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import SheetsAction from '../SheetsAction'

const fetchConnections = vi.fn()

vi.mock('@/lib/oauthApi', () => ({
  fetchConnections,
  refreshProvider: vi.fn(),
  disconnectProvider: vi.fn(),
  promoteConnection: vi.fn()
}))

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

  const googleConnections = {
    personal: {
      scope: 'personal',
      id: 'google-personal',
      connected: true,
      accountEmail: 'owner@example.com',
      expiresAt: '2025-01-01T00:00:00.000Z',
      isShared: false
    },
    workspace: [
      {
        scope: 'workspace',
        id: 'google-workspace',
        connected: true,
        accountEmail: 'ops@example.com',
        expiresAt: '2025-01-01T00:00:00.000Z',
        workspaceId: 'ws-1',
        workspaceName: 'Operations',
        sharedByName: 'Team Admin',
        sharedByEmail: 'admin@example.com'
      }
    ]
  }

  const emptyConnections = {
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

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders grouped connection options', async () => {
    fetchConnections.mockResolvedValueOnce({
      google: googleConnections,
      microsoft: emptyConnections
    })

    const user = userEvent.setup()
    render(<SheetsAction args={{ ...baseArgs }} />)

    await waitFor(() => expect(fetchConnections).toHaveBeenCalledTimes(1))

    const dropdownButton = await screen.findByRole('button', {
      name: /owner@example.com/i
    })
    await user.click(dropdownButton)

    expect(await screen.findByText('Your connections')).toBeInTheDocument()
    expect(screen.getByText('Workspace connections')).toBeInTheDocument()
  })

  it('shows workspace credential notice when selected', async () => {
    fetchConnections.mockResolvedValueOnce({
      google: googleConnections,
      microsoft: emptyConnections
    })

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
})

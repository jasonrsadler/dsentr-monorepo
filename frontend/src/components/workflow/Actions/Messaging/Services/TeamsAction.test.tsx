import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi } from 'vitest'
import TeamsAction from './TeamsAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'
import { updateCachedConnections } from '@/lib/oauthApi'

const secrets = {
  messaging: {
    teams: {
      existing: 'abc'
    }
  }
}

describe('TeamsAction', () => {
  const baseArgs = {
    webhookUrl: 'https://example.com/webhook',
    message: 'Hello Teams'
  }

  const createJsonResponse = (body: any, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })

  beforeEach(() => {
    vi.useFakeTimers()
    updateCachedConnections(() => null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    updateCachedConnections(() => null)
  })

  it('emits changes without validation errors', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0]).toMatchObject({
      deliveryMethod: 'Incoming Webhook',
      webhookType: 'Connector'
    })
    expect(lastCall?.[1]).toBe(false)
    expect(lastCall?.[2]).toBe(false)
  })

  it('validates webhook URL presence', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    const webhookInput = screen.getByPlaceholderText('Webhook URL')
    fireEvent.change(webhookInput, { target: { value: '' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(screen.getByText('Webhook URL is required')).toBeInTheDocument()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(true)
  })

  it('accepts the initialDirty flag', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} initialDirty />,
      { secrets }
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[2]).toBe(true)
  })

  it('validates raw JSON workflow payloads', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    const typeDropdown = screen.getByRole('button', {
      name: 'Connector'
    })
    fireEvent.click(typeDropdown)
    fireEvent.click(screen.getByText('Workflow/Power Automate'))

    const rawInput = screen.getByPlaceholderText('Raw JSON payload')
    fireEvent.change(rawInput, { target: { value: ' ' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(
        screen.getByText('Raw JSON payload is required')
      ).toBeInTheDocument()
    })

    fireEvent.change(rawInput, { target: { value: '{invalid' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(
        screen.getByText('Raw JSON payload must be valid JSON')
      ).toBeInTheDocument()
    })
  })

  it('validates header secret requirements', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    const typeDropdown = screen.getByRole('button', {
      name: 'Connector'
    })
    fireEvent.click(typeDropdown)
    fireEvent.click(screen.getByText('Workflow/Power Automate'))

    const workflowModeDropdown = screen.getByRole('button', {
      name: 'Basic (Raw JSON)'
    })
    fireEvent.click(workflowModeDropdown)
    fireEvent.click(screen.getByText('Header Secret Auth'))

    const rawInput = screen.getByPlaceholderText('Raw JSON payload')
    fireEvent.change(rawInput, {
      target: { value: '{"message":"ok"}' }
    })

    const headerNameInput = screen.getByPlaceholderText('Header Name')
    fireEvent.change(headerNameInput, { target: { value: '' } })

    await waitFor(() => {
      expect(screen.getByText('Header name is required')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('Header secret is required')).toBeInTheDocument()
    })
  })

  it('omits connector fields for workflow webhooks', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    const typeDropdown = screen.getByRole('button', {
      name: 'Connector'
    })
    fireEvent.click(typeDropdown)
    fireEvent.click(screen.getByText('Workflow/Power Automate'))

    const rawInput = screen.getByPlaceholderText('Raw JSON payload')
    fireEvent.change(rawInput, { target: { value: '{"kind":"test"}' } })
    vi.advanceTimersByTime(400)

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[0]).toMatchObject({
        webhookType: 'Workflow/Power Automate',
        workflowRawJson: '{"kind":"test"}'
      })
      expect(lastCall?.[0].message).toBe('')
      expect(lastCall?.[0].title).toBe('')
      expect(lastCall?.[0].themeColor).toBe('')
      expect(lastCall?.[0].cardJson).toBe('')
    })
  })

  it('clears header secret values when switching back to basic workflow auth', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      { secrets }
    )

    const typeDropdown = screen.getByRole('button', {
      name: 'Connector'
    })
    fireEvent.click(typeDropdown)
    fireEvent.click(screen.getByText('Workflow/Power Automate'))

    const workflowModeDropdown = screen.getByRole('button', {
      name: 'Basic (Raw JSON)'
    })
    fireEvent.click(workflowModeDropdown)
    fireEvent.click(screen.getByText('Header Secret Auth'))

    const rawInput = screen.getByPlaceholderText('Raw JSON payload')
    fireEvent.change(rawInput, {
      target: { value: '{"kind":"secret"}' }
    })

    const headerNameInput = screen.getByPlaceholderText('Header Name')
    fireEvent.change(headerNameInput, { target: { value: 'X-Test' } })
    const secretDropdown = screen.getByRole('button', {
      name: 'Select header secret'
    })
    fireEvent.click(secretDropdown)
    fireEvent.click(screen.getByText('existing'))
    vi.advanceTimersByTime(400)

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[0].workflowHeaderName).toBe('X-Test')
      expect(lastCall?.[0].workflowHeaderSecret).toBe('abc')
    })

    fireEvent.click(workflowModeDropdown)
    fireEvent.click(screen.getByText('Basic (Raw JSON)'))
    vi.advanceTimersByTime(400)

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[0].workflowHeaderName).toBe('')
      expect(lastCall?.[0].workflowHeaderSecret).toBe('')
      expect(lastCall?.[0].workflowOption).toBe('Basic (Raw JSON)')
    })
  })

  it('does not expose OAuth client credential controls in workflow mode', () => {
    renderWithSecrets(<TeamsAction args={{ ...baseArgs }} />, { secrets })

    const typeDropdown = screen.getByRole('button', {
      name: 'Connector'
    })
    fireEvent.click(typeDropdown)
    fireEvent.click(screen.getByText('Workflow/Power Automate'))

    const workflowModeDropdown = screen.getByRole('button', {
      name: 'Basic (Raw JSON)'
    })
    fireEvent.click(workflowModeDropdown)

    expect(
      screen.queryByText('OAuth Client Credentials')
    ).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Tenant ID')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Client ID')).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Client Secret')
    ).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('OAuth Scope')).not.toBeInTheDocument()
  })

  it('shows guidance when delegated OAuth has no Microsoft connection', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockImplementation((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : 'url' in input
                ? input.url
                : input.toString()

        if (url.includes('/api/oauth/connections')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              providers: {
                microsoft: { connected: false }
              }
            })
          )
        }

        return Promise.reject(new Error(`Unhandled fetch: ${url}`))
      })

    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      { secrets }
    )

    const deliveryDropdown = screen.getByRole('button', {
      name: 'Incoming Webhook'
    })
    fireEvent.click(deliveryDropdown)
    fireEvent.click(screen.getByText('Delegated OAuth (Post as user)'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(
        screen.getByText(
          'Connect the Microsoft integration in Settings → Integrations, then return to enable delegated messaging.'
        )
      ).toBeInTheDocument()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(true)
  })

  it('loads teams, channels, and members for delegated OAuth messaging', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockImplementation((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : 'url' in input
                ? input.url
                : input.toString()

        if (url.includes('/api/oauth/connections')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              providers: {
                microsoft: {
                  connected: true,
                  account_email: 'alice@example.com'
                }
              }
            })
          )
        }

        if (
          url.includes('/api/microsoft/teams/team-1/channels/channel-1/members')
        ) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              members: [
                {
                  id: 'member-1',
                  userId: 'user-1',
                  displayName: 'Jane Doe',
                  email: 'jane@example.com'
                }
              ]
            })
          )
        }

        if (url.includes('/api/microsoft/teams/team-1/channels')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              channels: [
                { id: 'channel-1', displayName: 'General' },
                { id: 'channel-2', displayName: 'Announcements' }
              ]
            })
          )
        }

        if (url.includes('/api/microsoft/teams')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              teams: [
                { id: 'team-1', displayName: 'Team One' },
                { id: 'team-2', displayName: 'Team Two' }
              ]
            })
          )
        }

        return Promise.reject(new Error(`Unhandled fetch: ${url}`))
      })

    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      { secrets }
    )

    const deliveryDropdown = screen.getByRole('button', {
      name: 'Incoming Webhook'
    })
    fireEvent.click(deliveryDropdown)
    fireEvent.click(screen.getByText('Delegated OAuth (Post as user)'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/oauth/connections'),
        expect.anything()
      )
    })

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: /Microsoft \(alice@example.com\)/i
        })
      ).toBeInTheDocument()
    })

    const teamDropdown = await screen.findByRole('button', {
      name: 'Select team'
    })
    fireEvent.click(teamDropdown)
    fireEvent.click(await screen.findByText('Team One'))

    const channelDropdown = await screen.findByRole('button', {
      name: 'Select channel'
    })
    fireEvent.click(channelDropdown)
    fireEvent.click(await screen.findByText('General'))

    await waitFor(() => {
      expect(
        screen.getByLabelText('Jane Doe (jane@example.com)')
      ).toBeInTheDocument()
    })

    const messageField = screen.getByPlaceholderText('Message')
    fireEvent.change(messageField, {
      target: { value: 'Hello delegated world' }
    })

    const mentionCheckbox = screen.getByLabelText('Jane Doe (jane@example.com)')
    fireEvent.click(mentionCheckbox)

    vi.advanceTimersByTime(400)

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[0]).toMatchObject({
        deliveryMethod: 'Delegated OAuth (Post as user)',
        oauthAccountEmail: 'alice@example.com',
        teamId: 'team-1',
        teamName: 'Team One',
        channelId: 'channel-1',
        channelName: 'General',
        messageType: 'Text',
        message: 'Hello delegated world'
      })
      expect(lastCall?.[0].mentions).toEqual([
        { userId: 'user-1', displayName: 'Jane Doe' }
      ])
      expect(lastCall?.[1]).toBe(false)
    })
  })

  it('clears delegated workspace selections when a shared credential is removed while editing', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockImplementation((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : 'url' in input
                ? input.url
                : input.toString()

        if (url.includes('/api/oauth/connections')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              personal: [
                {
                  id: 'microsoft-personal',
                  provider: 'microsoft',
                  accountEmail: 'owner@example.com',
                  expiresAt: '2025-01-01T00:00:00.000Z',
                  isShared: true,
                  requiresReconnect: false
                }
              ],
              workspace: [
                {
                  id: 'workspace-shared',
                  provider: 'microsoft',
                  accountEmail: 'ops@example.com',
                  expiresAt: '2025-01-01T00:00:00.000Z',
                  workspaceId: 'ws-1',
                  workspaceName: 'Operations',
                  sharedByName: 'Owner User',
                  sharedByEmail: 'owner@example.com',
                  requiresReconnect: false
                }
              ]
            })
          )
        }

        return Promise.reject(new Error(`Unhandled fetch: ${url}`))
      })

    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction
        args={{
          ...baseArgs,
          deliveryMethod: 'Delegated OAuth (Post as user)',
          oauthProvider: 'microsoft',
          oauthConnectionScope: 'workspace',
          oauthConnectionId: 'workspace-shared',
          oauthAccountEmail: 'ops@example.com'
        }}
        onChange={onChange}
      />,
      { secrets }
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/oauth/connections'),
        expect.anything()
      )
    })

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: /workspace credential/i
        })
      ).toBeInTheDocument()
    })

    await act(async () => {
      updateCachedConnections((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          microsoft: {
            personal: {
              ...prev.microsoft.personal,
              isShared: false
            },
            workspace: []
          }
        }
      })
    })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Select Microsoft connection' })
      ).toBeInTheDocument()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0]).toMatchObject({
      oauthProvider: 'microsoft',
      oauthConnectionScope: '',
      oauthConnectionId: '',
      oauthAccountEmail: ''
    })
  })

  it('removes revoked workspace credentials from delegated selections', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [
          {
            id: 'microsoft-personal',
            provider: 'microsoft',
            accountEmail: 'owner@example.com',
            expiresAt: '2025-01-01T00:00:00.000Z',
            isShared: true,
            requiresReconnect: false
          }
        ],
        workspace: [
          {
            id: 'workspace-shared',
            provider: 'microsoft',
            accountEmail: 'ops@example.com',
            expiresAt: '2025-01-01T00:00:00.000Z',
            workspaceId: 'ws-1',
            workspaceName: 'Operations',
            sharedByName: 'Owner User',
            sharedByEmail: 'owner@example.com',
            requiresReconnect: true
          }
        ]
      })
    )

    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction
        args={{
          ...baseArgs,
          deliveryMethod: 'Delegated OAuth (Post as user)',
          oauthProvider: 'microsoft',
          oauthConnectionScope: 'workspace',
          oauthConnectionId: 'workspace-shared',
          oauthAccountEmail: 'ops@example.com'
        }}
        onChange={onChange}
      />,
      { secrets }
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Select Microsoft connection' })
      ).toBeInTheDocument()
    )

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0]).toMatchObject({
      oauthProvider: 'microsoft',
      oauthConnectionScope: '',
      oauthConnectionId: '',
      oauthAccountEmail: ''
    })
  })

  it('builds delegated adaptive cards without manual JSON', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockImplementation((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : 'url' in input
                ? input.url
                : input.toString()

        if (url.includes('/api/oauth/connections')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              providers: {
                microsoft: {
                  connected: true,
                  account_email: 'alice@example.com'
                }
              }
            })
          )
        }

        if (
          url.includes('/api/microsoft/teams/team-1/channels/channel-1/members')
        ) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              members: []
            })
          )
        }

        if (url.includes('/api/microsoft/teams/team-1/channels')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              channels: [
                { id: 'channel-1', displayName: 'General' },
                { id: 'channel-2', displayName: 'Announcements' }
              ]
            })
          )
        }

        if (url.includes('/api/microsoft/teams')) {
          return Promise.resolve(
            createJsonResponse({
              success: true,
              teams: [
                { id: 'team-1', displayName: 'Team One' },
                { id: 'team-2', displayName: 'Team Two' }
              ]
            })
          )
        }

        return Promise.reject(new Error(`Unhandled fetch: ${url}`))
      })

    const onChange = vi.fn()
    renderWithSecrets(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} />,
      { secrets }
    )

    const deliveryDropdown = screen.getByRole('button', {
      name: 'Incoming Webhook'
    })
    fireEvent.click(deliveryDropdown)
    fireEvent.click(screen.getByText('Delegated OAuth (Post as user)'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/oauth/connections'),
        expect.anything()
      )
    })

    const teamDropdown = await screen.findByRole('button', {
      name: 'Select team'
    })
    fireEvent.click(teamDropdown)
    fireEvent.click(await screen.findByText('Team One'))

    const channelDropdown = await screen.findByRole('button', {
      name: 'Select channel'
    })
    fireEvent.click(channelDropdown)
    fireEvent.click(await screen.findByText('General'))

    const messageTypeDropdown = screen.getByRole('button', { name: 'Text' })
    fireEvent.click(messageTypeDropdown)
    fireEvent.click(screen.getByText('Card'))

    await screen.findByRole('button', {
      name: 'Simple card builder'
    })

    const titleInput = screen.getByPlaceholderText('Card title (optional)')
    fireEvent.change(titleInput, { target: { value: 'Hello from Dsentr' } })

    const bodyInput = screen.getByPlaceholderText('Card message')
    fireEvent.change(bodyInput, {
      target: { value: 'Your automation ran successfully.' }
    })

    vi.advanceTimersByTime(400)

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[0]).toMatchObject({
        deliveryMethod: 'Delegated OAuth (Post as user)',
        messageType: 'Card',
        cardMode: 'Simple card builder',
        cardTitle: 'Hello from Dsentr',
        cardBody: 'Your automation ran successfully.'
      })
    })

    const lastCall = onChange.mock.calls.at(-1)
    const cardJson = lastCall?.[0].cardJson
    expect(typeof cardJson).toBe('string')
    expect(cardJson).toBeTruthy()

    const parsed = JSON.parse(cardJson as string)
    expect(parsed).toEqual({
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: 'Hello from Dsentr',
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'TextBlock',
          text: 'Your automation ran successfully.',
          wrap: true
        }
      ]
    })
  })
})

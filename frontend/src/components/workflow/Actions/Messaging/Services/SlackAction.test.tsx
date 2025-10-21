import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import SlackAction from './SlackAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'

const createJsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

describe('SlackAction', () => {
  const baseArgs = {
    channel: '#alerts',
    message: 'Hello',
    token: 'xoxb-token'
  }

  const secrets = {
    messaging: {
      slack: {
        primary: 'xoxb-token'
      }
    }
  }

  let fetchMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi
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
            createJsonResponse({ success: true, personal: [], workspace: [] })
          )
        }

        return Promise.reject(new Error(`Unhandled fetch: ${url}`))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits values without validation errors when inputs are valid', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <SlackAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(false)
    expect(lastCall?.[2]).toBe(false)
  })

  it('marks inputs dirty when fields change', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <SlackAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const channelInput = screen.getByPlaceholderText('Channel (e.g. #general)')
    fireEvent.change(channelInput, { target: { value: '#ops' } })

    await waitFor(() => {
      expect(onChange.mock.calls.length).toBeGreaterThan(1)
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0].channel).toBe('#ops')
    expect(lastCall?.[2]).toBe(true)
  })

  it('propagates validation errors for empty message', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <SlackAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const messageInput = screen.getByPlaceholderText('Message')
    fireEvent.change(messageInput, { target: { value: '' } })

    await waitFor(() => {
      expect(screen.getByText('Message cannot be empty')).toBeInTheDocument()
    })

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[1]).toBe(true)
    })
  })

  it('respects the initialDirty flag', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <SlackAction args={{ ...baseArgs }} onChange={onChange} initialDirty />,
      { secrets }
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[2]).toBe(true)
    })
  })

  it('allows selecting a personal Slack OAuth connection', async () => {
    const personalId = '11111111-2222-3333-4444-555555555555'
    fetchMock.mockImplementationOnce((input: RequestInfo | URL) => {
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
                id: personalId,
                provider: 'slack',
                accountEmail: 'alice@example.com',
                expiresAt: new Date().toISOString(),
                isShared: false,
                requiresReconnect: false
              }
            ],
            workspace: []
          })
        )
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })

    const onChange = vi.fn()
    renderWithSecrets(
      <SlackAction args={{ ...baseArgs, token: '' }} onChange={onChange} />,
      { secrets }
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const dropdown = screen.getByRole('button', {
      name: 'Use manual Slack token'
    })
    fireEvent.click(dropdown)

    const personalOption = await screen.findByText(
      'Personal – alice@example.com'
    )
    fireEvent.click(personalOption)

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[0].connectionScope).toBe('user')
      expect(lastCall?.[0].connectionId).toBe(personalId)
      expect(lastCall?.[0].accountEmail).toBe('alice@example.com')
      expect(lastCall?.[0].token).toBe('')
      expect(lastCall?.[1]).toBe(false)
    })

    expect(
      screen.getByText('Posting as alice@example.com via Slack OAuth.')
    ).toBeInTheDocument()

    const tokenDropdown = screen.getByRole('button', { name: 'primary' })
    expect(tokenDropdown).toBeDisabled()
  })

  it('emits workspace Slack OAuth metadata when selected', async () => {
    const workspaceConnectionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    fetchMock.mockImplementationOnce((input: RequestInfo | URL) => {
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
            personal: [],
            workspace: [
              {
                id: workspaceConnectionId,
                provider: 'slack',
                accountEmail: 'workspace@example.com',
                workspaceId: 'workspace-1',
                workspaceName: 'Acme Workspace',
                sharedByName: 'Owner',
                sharedByEmail: 'owner@example.com',
                expiresAt: new Date().toISOString(),
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
      <SlackAction args={{ ...baseArgs, token: '' }} onChange={onChange} />,
      { secrets }
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const dropdown = screen.getByRole('button', {
      name: 'Use manual Slack token'
    })
    fireEvent.click(dropdown)

    const workspaceOption = await screen.findByText(
      'Acme Workspace – workspace@example.com'
    )
    fireEvent.click(workspaceOption)

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[0].connectionScope).toBe('workspace')
      expect(lastCall?.[0].connectionId).toBe(workspaceConnectionId)
      expect(lastCall?.[0].accountEmail).toBe('workspace@example.com')
      expect(lastCall?.[0].token).toBe('')
      expect(lastCall?.[1]).toBe(false)
    })

    expect(
      screen.getByText('Posting as workspace@example.com via Slack OAuth.')
    ).toBeInTheDocument()
  })
})

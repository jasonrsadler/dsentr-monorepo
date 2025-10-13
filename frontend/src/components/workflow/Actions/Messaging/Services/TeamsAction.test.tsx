import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import TeamsAction from './TeamsAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'

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

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
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
})

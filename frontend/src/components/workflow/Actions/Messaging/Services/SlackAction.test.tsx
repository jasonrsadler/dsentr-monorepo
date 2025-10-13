import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import SlackAction from './SlackAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'

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

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
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

    const channelInput = screen.getByPlaceholderText('Channel (e.g. #general)')
    fireEvent.change(channelInput, { target: { value: '#ops' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
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

    const messageInput = screen.getByPlaceholderText('Message')
    fireEvent.change(messageInput, { target: { value: '' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(screen.getByText('Message cannot be empty')).toBeInTheDocument()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(true)
  })

  it('respects the initialDirty flag', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <SlackAction args={{ ...baseArgs }} onChange={onChange} initialDirty />,
      { secrets }
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[2]).toBe(true)
  })
})

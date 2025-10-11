import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import MessagingAction from './MessagingAction'

describe('MessagingAction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('defaults to Slack and emits initial platform selection', async () => {
    const onChange = vi.fn()
    render(<MessagingAction args={{}} onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0].platform).toBe('Slack')
  })

  it('preserves service specific fields when switching platforms', async () => {
    const onChange = vi.fn()
    render(<MessagingAction args={{}} onChange={onChange} />)

    const channelInput = screen.getByPlaceholderText('Channel (e.g. #general)')
    fireEvent.change(channelInput, { target: { value: '#alerts' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const slackCall = onChange.mock.calls.at(-1)
    expect(slackCall?.[0].channel).toBe('#alerts')

    const dropdown = screen.getByRole('button', { name: 'Slack' })
    fireEvent.click(dropdown)
    fireEvent.click(screen.getByText('Teams'))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const webhookInput = screen.getByPlaceholderText('Webhook URL')
    fireEvent.change(webhookInput, { target: { value: 'https://example.com' } })
    vi.advanceTimersByTime(300)

    const messageInput = screen.getByPlaceholderText('Message')
    fireEvent.change(messageInput, { target: { value: 'Hello Teams' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const backToSlackDropdown = screen.getByRole('button', { name: 'Teams' })
    fireEvent.click(backToSlackDropdown)
    fireEvent.click(screen.getByText('Slack'))

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Channel (e.g. #general)')
      ).toHaveValue('#alerts')
    })
  })
})

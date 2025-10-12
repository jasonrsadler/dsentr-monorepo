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

  it('shows Google Chat text message fields and helper text when selected', async () => {
    const onChange = vi.fn()
    render(<MessagingAction args={{}} onChange={onChange} />)

    const dropdown = screen.getByRole('button', { name: 'Slack' })
    fireEvent.click(dropdown)
    fireEvent.click(screen.getByText('Google Chat'))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Use your Google Chat webhook URL. Send simple text or provide a cardsV2 JSON payload.'
        )
      ).toBeInTheDocument()
    })

    const webhookInput = screen.getByPlaceholderText('Webhook URL')
    fireEvent.change(webhookInput, {
      target: { value: 'https://chat.example.com' }
    })
    vi.advanceTimersByTime(300)

    const payloadDropdown = screen.getByRole('button', { name: 'Text message' })
    expect(payloadDropdown).toBeInTheDocument()

    const messageField = screen.getByPlaceholderText('Message')
    fireEvent.change(messageField, { target: { value: 'Hello Chat' } })
    vi.advanceTimersByTime(800)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0].webhookUrl).toBe('https://chat.example.com')
    expect(lastCall?.[0].message).toBe('Hello Chat')
    expect(lastCall?.[0].cardJson).toBe('')
  })

  it('allows sending Google Chat cards when selected', async () => {
    const onChange = vi.fn()
    render(<MessagingAction args={{}} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Slack' }))
    fireEvent.click(screen.getByText('Google Chat'))

    const webhookInput = screen.getByPlaceholderText('Webhook URL')
    fireEvent.change(webhookInput, {
      target: { value: 'https://chat.example.com' }
    })
    vi.advanceTimersByTime(300)

    const payloadDropdown = screen.getByRole('button', { name: 'Text message' })
    fireEvent.click(payloadDropdown)
    fireEvent.click(screen.getByText('Card JSON (cardsV2)'))

    const cardField = screen.getByPlaceholderText('cardsV2 JSON')
    fireEvent.change(cardField, {
      target: {
        value: '{"cardsV2":[{"cardId":"info"}]}'
      }
    })
    vi.advanceTimersByTime(800)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0].cardJson).toBe('{"cardsV2":[{"cardId":"info"}]}')
    expect(lastCall?.[0].message).toBe('')
  })

  it('keeps Google Chat card JSON input stable while typing', async () => {
    const onChange = vi.fn()
    render(<MessagingAction args={{}} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Slack' }))
    fireEvent.click(screen.getByText('Google Chat'))

    const payloadDropdown = screen.getByRole('button', { name: 'Text message' })
    fireEvent.click(payloadDropdown)
    fireEvent.click(screen.getByText('Card JSON (cardsV2)'))

    const cardField = screen.getByPlaceholderText('cardsV2 JSON')
    fireEvent.change(cardField, { target: { value: '{' } })

    expect(cardField).toHaveValue('{')

    fireEvent.change(cardField, {
      target: { value: '{"cardsV2":[{"cardId":"info"}]}' }
    })
    vi.advanceTimersByTime(800)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0].cardJson).toBe('{"cardsV2":[{"cardId":"info"}]}')
  })
})

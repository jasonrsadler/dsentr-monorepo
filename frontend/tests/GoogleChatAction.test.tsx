import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import GoogleChatAction from '../src/components/workflow/Actions/Messaging/Services/GoogleChatAction'

describe('GoogleChatAction', () => {
  const baseArgs = {
    webhookUrl: 'https://chat.googleapis.com/v1/webhook',
    message: 'Hello Chat'
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('reports clean state for valid inputs', async () => {
    const onChange = vi.fn()
    render(<GoogleChatAction args={{ ...baseArgs }} onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(false)
    expect(lastCall?.[2]).toBe(false)
  })

  it('raises validation error when message cleared', async () => {
    const onChange = vi.fn()
    render(<GoogleChatAction args={{ ...baseArgs }} onChange={onChange} />)

    const messageInput = screen.getByPlaceholderText('Message')
    fireEvent.change(messageInput, { target: { value: '' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(screen.getByText('Message cannot be empty')).toBeInTheDocument()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(true)
  })

  it('initialDirty indicates pre-existing edits', async () => {
    const onChange = vi.fn()
    render(
      <GoogleChatAction
        args={{ ...baseArgs }}
        onChange={onChange}
        initialDirty
      />
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[2]).toBe(true)
  })
})

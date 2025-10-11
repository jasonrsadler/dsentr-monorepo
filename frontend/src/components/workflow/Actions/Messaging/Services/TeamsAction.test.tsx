import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import TeamsAction from './TeamsAction'

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
    render(<TeamsAction args={{ ...baseArgs }} onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(false)
    expect(lastCall?.[2]).toBe(false)
  })

  it('validates webhook URL presence', async () => {
    const onChange = vi.fn()
    render(<TeamsAction args={{ ...baseArgs }} onChange={onChange} />)

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
    render(
      <TeamsAction args={{ ...baseArgs }} onChange={onChange} initialDirty />
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[2]).toBe(true)
  })
})

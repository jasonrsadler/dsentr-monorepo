import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SendGridAction from './SendGridAction'
import { vi } from 'vitest'

describe('SendGridAction', () => {
  const baseArgs = {
    apiKey: 'key-123',
    from: 'from@example.com',
    to: 'user@example.com',
    subject: 'Hello',
    body: 'Body',
    dirty: false
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('emits updates without validation errors for valid inputs', async () => {
    const onChange = vi.fn()
    render(<SendGridAction args={{ ...baseArgs }} onChange={onChange} />)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(false)
  })

  it('surfaces validation errors for invalid recipient emails', async () => {
    const onChange = vi.fn()
    render(<SendGridAction args={{ ...baseArgs }} onChange={onChange} />)

    const input = screen.getByPlaceholderText('Recipient Email(s)')
    fireEvent.change(input, { target: { value: 'invalid-email' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(
        screen.getByText('One or more recipient emails are invalid')
      ).toBeInTheDocument()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(true)
  })

  it('hides subject and body inputs when using a template', () => {
    render(
      <SendGridAction
        args={{ ...baseArgs, templateId: 'tmpl-1', subject: '', body: '' }}
      />
    )

    expect(screen.queryByPlaceholderText('Subject')).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Message Body')
    ).not.toBeInTheDocument()
  })
})

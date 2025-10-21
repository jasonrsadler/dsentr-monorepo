import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import SMTPAction from '../src/components/workflow/Actions/Email/Services/SMTPAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'

const secrets = {
  email: {
    smtp: {
      primary: 'secret'
    }
  }
}

describe('SMTPAction', () => {
  const baseArgs = {
    smtpHost: 'smtp.example.com',
    smtpPort: 2525,
    smtpUser: 'user@example.com',
    smtpPassword: 'secret',
    smtpTls: true,
    smtpTlsMode: 'starttls' as const,
    from: 'sender@example.com',
    to: 'alice@example.com',
    subject: 'Hello',
    body: 'Body',
    dirty: false,
    setParams: vi.fn(),
    setDirty: vi.fn()
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
    renderWithSecrets(
      <SMTPAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(false)
    expect(lastCall?.[0].smtpPort).toBe(2525)
    expect(lastCall?.[0].smtpTlsMode).toBe('starttls')
  })

  it('surfaces validation errors for invalid recipients', async () => {
    renderWithSecrets(<SMTPAction args={{ ...baseArgs }} />, { secrets })

    const recipientField = screen.getByPlaceholderText('Recipient Email(s)')
    fireEvent.change(recipientField, { target: { value: 'invalid-email' } })
    vi.advanceTimersByTime(300)

    await waitFor(() => {
      expect(
        screen.getByText('One or more recipient emails are invalid')
      ).toBeInTheDocument()
    })
  })

  it('switches encryption modes and updates default ports when unchanged', async () => {
    renderWithSecrets(
      <SMTPAction
        args={{ ...baseArgs, smtpPort: 587, smtpTlsMode: 'starttls' }}
      />,
      { secrets }
    )

    const portField = screen.getByPlaceholderText(
      'SMTP Port'
    ) as HTMLInputElement
    const startTlsOption = screen.getByLabelText(
      'TLS - Use STARTTLS (recommended)'
    )
    const implicitOption = screen.getByLabelText(
      'TLS/SSL - Use Implicit TLS/SSL (legacy - not recommended)'
    )
    const noTlsOption = screen.getByLabelText(
      'Do not use TLS (insecure - only if required)'
    )

    expect((startTlsOption as HTMLInputElement).checked).toBe(true)
    expect(portField.value).toBe('587')

    fireEvent.click(implicitOption)
    await waitFor(() => {
      expect(portField.value).toBe('465')
    })

    fireEvent.click(noTlsOption)
    await waitFor(() => {
      expect(portField.value).toBe('25')
    })

    fireEvent.click(startTlsOption)
    await waitFor(() => {
      expect(portField.value).toBe('587')
    })
  })
})

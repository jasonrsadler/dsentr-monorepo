import { screen, fireEvent, waitFor } from '@testing-library/react'
import MailGunAction from '../src/components/workflow/Actions/Email/Services/MailGunAction'
import { vi } from 'vitest'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'

const secrets = {
  email: {
    mailgun: {
      primary: 'key-123'
    }
  }
}

describe('MailGunAction', () => {
  const baseArgs = {
    domain: 'mg.example.com',
    apiKey: 'key-123',
    region: 'US (api.mailgun.net)',
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
    renderWithSecrets(
      <MailGunAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(false)
  })

  it('surfaces validation errors for invalid recipients', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <MailGunAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    const input = screen.getByPlaceholderText('To (comma separated)')
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

  it('renders template variable editor when template is provided', () => {
    renderWithSecrets(
      <MailGunAction
        args={{
          ...baseArgs,
          template: 'welcome-email',
          subject: '',
          body: ''
        }}
      />,
      { secrets }
    )

    expect(screen.queryByPlaceholderText('Subject')).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Body (plain text or HTML)')
    ).not.toBeInTheDocument()
    expect(screen.getByText('Template Variables')).toBeInTheDocument()
  })

  it('updates region selection through the dropdown', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <MailGunAction args={{ ...baseArgs }} onChange={onChange} />,
      {
        secrets
      }
    )

    const regionButton = screen.getByRole('button', {
      name: /us \(api\.mailgun\.net\)/i
    })
    fireEvent.click(regionButton)
    const euOption = screen.getByText('EU (api.eu.mailgun.net)')
    fireEvent.click(euOption)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0].region).toBe('EU (api.eu.mailgun.net)')
  })
})

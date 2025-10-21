import { fireEvent, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import AmazonSESAction from '@/components/workflow/Actions/Email/Services/AmazonSESAction'
import { renderWithSecrets } from 'tests/test-utils/renderWithSecrets'
import type { SecretStore } from '@/lib/optionsApi'

const secrets: SecretStore = {
  email: {
    amazon_ses: {
      primary: {
        value: 'secret',
        ownerId: ''
      }
    }
  }
}

describe('AmazonSESAction', () => {
  const baseArgs = {
    awsAccessKey: 'AKIAFAKE',
    awsSecretKey: 'secret',
    awsRegion: 'us-east-1',
    sesVersion: 'v2',
    fromEmail: 'sender@example.com',
    toEmail: 'user@example.com',
    subject: 'Hello',
    body: 'Body'
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('emits updates without validation errors when inputs are valid', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <AmazonSESAction args={{ ...baseArgs }} onChange={onChange} />,
      { secrets }
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe(false)
  })

  it('surfaces an error when region is not selected', async () => {
    renderWithSecrets(
      <AmazonSESAction
        args={{
          ...baseArgs,
          awsRegion: ''
        }}
      />,
      { secrets }
    )

    await waitFor(() => {
      expect(screen.getByText('Region is required')).toBeInTheDocument()
    })
    expect(
      screen.queryByText('SES version is required')
    ).not.toBeInTheDocument()
  })

  it('defaults SES version to v2 when not provided', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <AmazonSESAction
        args={{
          ...baseArgs,
          sesVersion: ''
        }}
        onChange={onChange}
      />,
      { secrets }
    )

    const versionButton = screen.getByRole('button', {
      name: /ses v2 \(api\)/i
    })
    expect(versionButton).toBeInTheDocument()

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })

    const lastCall = onChange.mock.calls.at(-1)
    expect(lastCall?.[0].sesVersion).toBe('v2')
  })

  it('allows the user to change SES version via dropdown', async () => {
    const onChange = vi.fn()
    renderWithSecrets(
      <AmazonSESAction
        args={{
          ...baseArgs,
          sesVersion: 'v1'
        }}
        onChange={onChange}
      />,
      { secrets }
    )

    const versionButton = screen.getByRole('button', {
      name: /ses v1 \(classic\)/i
    })
    fireEvent.click(versionButton)

    const v2Option = screen.getByText('SES v2 (API)')
    fireEvent.click(v2Option)
    vi.advanceTimersByTime(0)

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)
      expect(lastCall?.[0].sesVersion).toBe('v2')
    })
  })

  it('shows template variables editor when a template is provided', () => {
    renderWithSecrets(
      <AmazonSESAction
        args={{
          ...baseArgs,
          template: 'welcome-email',
          subject: '',
          body: ''
        }}
      />,
      { secrets }
    )

    expect(screen.getByText('Template Variables')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Subject')).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Body (plain text or HTML)')
    ).not.toBeInTheDocument()
  })
})

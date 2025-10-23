import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SMTPAction from '../src/components/workflow/Actions/Email/Services/SMTPAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'
import { useWorkflowStore } from '@/stores/workflowStore'

const secrets = {
  email: {
    smtp: {
      primary: 'secret'
    }
  }
}

const nodeId = 'smtp-node'

const baseParams = {
  service: 'SMTP',
  smtpHost: 'smtp.example.com',
  smtpPort: 2525,
  smtpUser: 'user@example.com',
  smtpPassword: 'secret',
  smtpTls: true,
  smtpTlsMode: 'starttls' as const,
  from: 'sender@example.com',
  to: 'alice@example.com',
  subject: 'Hello',
  body: 'Body'
}

const resetStore = () => {
  act(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      isDirty: false,
      isSaving: false,
      canEdit: true
    })
  })
}

const initializeStore = (paramsOverride: Record<string, unknown> = {}) => {
  act(() => {
    useWorkflowStore.setState((state) => ({
      ...state,
      nodes: [
        {
          id: nodeId,
          type: 'email',
          position: { x: 0, y: 0 },
          data: {
            actionType: 'email',
            params: { ...baseParams, ...paramsOverride },
            dirty: false,
            hasValidationErrors: false
          }
        }
      ],
      edges: []
    }))
  })
}

describe('SMTPAction', () => {
  beforeEach(() => {
    initializeStore()
  })

  afterEach(() => {
    resetStore()
  })

  const getNodeData = () =>
    useWorkflowStore.getState().nodes.find((node) => node.id === nodeId)
      ?.data as Record<string, any>

  it('writes validation state to the workflow store when inputs are valid', async () => {
    renderWithSecrets(<SMTPAction nodeId={nodeId} />, { secrets })

    await waitFor(() => {
      const data = getNodeData()
      expect(data?.hasValidationErrors).toBe(false)
    })
  })

  it('surfaces validation errors for invalid recipients', async () => {
    renderWithSecrets(<SMTPAction nodeId={nodeId} />, { secrets })

    const recipientField = screen.getByPlaceholderText('Recipient Email(s)')
    fireEvent.change(recipientField, { target: { value: 'invalid-email' } })

    await waitFor(() => {
      expect(
        screen.getByText('One or more recipient emails are invalid')
      ).toBeInTheDocument()
    })

    const data = getNodeData()
    expect(data?.hasValidationErrors).toBe(true)
  })

  it('switches encryption modes and updates default ports when unchanged', async () => {
    initializeStore({ smtpPort: 587, smtpTlsMode: 'starttls' })

    renderWithSecrets(<SMTPAction nodeId={nodeId} />, { secrets })

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

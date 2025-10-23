import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

import MailGunAction from '../src/components/workflow/Actions/Email/Services/MailGunAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'
import { useWorkflowStore } from '@/stores/workflowStore'

const secrets = {
  email: {
    mailgun: {
      primary: 'key-123'
    }
  }
}

const nodeId = 'mailgun-node'

const baseParams = {
  service: 'Mailgun',
  domain: 'mg.example.com',
  apiKey: 'key-123',
  region: 'US (api.mailgun.net)',
  from: 'from@example.com',
  to: 'user@example.com',
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

describe('MailGunAction', () => {
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
    renderWithSecrets(<MailGunAction nodeId={nodeId} />, { secrets })

    await waitFor(() => {
      const data = getNodeData()
      expect(data?.hasValidationErrors).toBe(false)
    })
  })

  it('surfaces validation errors for invalid recipients', async () => {
    renderWithSecrets(<MailGunAction nodeId={nodeId} />, { secrets })

    const input = screen.getByPlaceholderText('To (comma separated)')
    fireEvent.change(input, { target: { value: 'invalid-email' } })

    await waitFor(() => {
      expect(
        screen.getByText('One or more recipient emails are invalid')
      ).toBeInTheDocument()
    })

    const data = getNodeData()
    expect(data?.hasValidationErrors).toBe(true)
  })

  it('renders template variable editor when template is provided', () => {
    initializeStore({
      template: 'welcome-email',
      subject: '',
      body: ''
    })

    renderWithSecrets(<MailGunAction nodeId={nodeId} />, { secrets })

    expect(screen.queryByPlaceholderText('Subject')).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Body (plain text or HTML)')
    ).not.toBeInTheDocument()
    expect(screen.getByText('Template Variables')).toBeInTheDocument()
  })

  it('updates region selection through the dropdown', async () => {
    renderWithSecrets(<MailGunAction nodeId={nodeId} />, { secrets })

    const regionButton = screen.getByRole('button', {
      name: /us \(api\.mailgun\.net\)/i
    })
    fireEvent.click(regionButton)
    const euOption = screen.getByText('EU (api.eu.mailgun.net)')
    fireEvent.click(euOption)

    await waitFor(() => {
      const data = getNodeData()
      expect(data?.params?.region).toBe('EU (api.eu.mailgun.net)')
      expect(data?.dirty).toBe(true)
    })
  })
})

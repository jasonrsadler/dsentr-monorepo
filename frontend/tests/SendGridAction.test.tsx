import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SendGridAction from '../src/components/workflow/Actions/Email/Services/SendGridAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'
import { useWorkflowStore } from '@/stores/workflowStore'

const secrets = {
  email: {
    sendgrid: {
      primary: 'key-123'
    }
  }
}

const nodeId = 'sendgrid-node'

const baseParams = {
  service: 'SendGrid',
  apiKey: 'key-123',
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

describe('SendGridAction', () => {
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
    renderWithSecrets(<SendGridAction nodeId={nodeId} />, { secrets })

    await waitFor(() => {
      const data = getNodeData()
      expect(data?.hasValidationErrors).toBe(false)
    })
  })

  it('surfaces validation errors for invalid recipient emails', async () => {
    renderWithSecrets(<SendGridAction nodeId={nodeId} />, { secrets })

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

  it('hides subject and body inputs when using a template', () => {
    initializeStore({ templateId: 'tmpl-1', subject: '', body: '' })

    renderWithSecrets(<SendGridAction nodeId={nodeId} />, { secrets })

    expect(screen.queryByPlaceholderText('Subject')).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Body (plain text or HTML)')
    ).not.toBeInTheDocument()
  })
})

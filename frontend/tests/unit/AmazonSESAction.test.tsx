import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import AmazonSESAction from '@/components/workflow/Actions/Email/Services/AmazonSESAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'
import { useWorkflowStore } from '@/stores/workflowStore'

const secrets = {
  email: {
    amazon_ses: {
      primary: 'secret'
    }
  }
}

const nodeId = 'ses-node'

const baseParams = {
  service: 'Amazon SES',
  awsAccessKey: 'AKIAFAKE',
  awsSecretKey: 'secret',
  awsRegion: 'us-east-1',
  sesVersion: 'v2',
  fromEmail: 'sender@example.com',
  toEmail: 'user@example.com',
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

describe('AmazonSESAction', () => {
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
    renderWithSecrets(<AmazonSESAction nodeId={nodeId} />, { secrets })

    await waitFor(() => {
      const data = getNodeData()
      expect(data?.hasValidationErrors).toBe(false)
    })
  })

  it('surfaces an error when region is not selected', async () => {
    initializeStore({ awsRegion: '' })

    renderWithSecrets(<AmazonSESAction nodeId={nodeId} />, { secrets })

    await waitFor(() => {
      expect(screen.getByText('Region is required')).toBeInTheDocument()
    })

    const data = getNodeData()
    expect(data?.hasValidationErrors).toBe(true)
  })

  it('allows the user to change SES version via dropdown', async () => {
    initializeStore({ sesVersion: 'v1' })

    renderWithSecrets(<AmazonSESAction nodeId={nodeId} />, { secrets })

    const versionButton = screen.getByRole('button', {
      name: /ses v1 \(classic\)/i
    })
    fireEvent.click(versionButton)

    const v2Option = screen.getByText('SES v2 (API)')
    fireEvent.click(v2Option)

    await waitFor(() => {
      const data = getNodeData()
      expect(data?.params?.sesVersion).toBe('v2')
    })
  })

  it('shows template variables editor when a template is provided', () => {
    initializeStore({ template: 'welcome-email', subject: '', body: '' })

    renderWithSecrets(<AmazonSESAction nodeId={nodeId} />, { secrets })

    expect(screen.getByText('Template Variables')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Subject')).not.toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Body (plain text or HTML)')
    ).not.toBeInTheDocument()
  })
})

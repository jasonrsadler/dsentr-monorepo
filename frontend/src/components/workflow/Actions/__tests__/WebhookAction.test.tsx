import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import WebhookAction from '../Webhook/Webhook'
import type { WebhookActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

const nodeId = 'webhook-node'

const createBaseParams = (
  overrides: Partial<WebhookActionParams> = {}
): WebhookActionParams => ({
  url: '',
  method: 'GET',
  headers: [],
  queryParams: [],
  bodyType: 'raw',
  body: '',
  formBody: [],
  authType: 'none',
  authUsername: '',
  authPassword: '',
  authToken: '',
  dirty: false,
  ...overrides
})

const seedWebhookNode = (params: WebhookActionParams) => {
  useWorkflowStore.setState((state) => ({
    ...state,
    nodes: [
      {
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          label: 'Webhook',
          params,
          dirty: false,
          hasValidationErrors: false
        }
      } as any
    ],
    edges: [],
    isDirty: false,
    canEdit: true
  }))

  const updateNodeData = vi.fn((id: string, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return

    useWorkflowStore.setState((state) => ({
      ...state,
      nodes: state.nodes.map((node) => {
        if (node.id !== id) return node
        const currentData =
          node.data && typeof node.data === 'object'
            ? (node.data as Record<string, unknown>)
            : {}
        return {
          ...node,
          data: {
            ...currentData,
            ...(payload as Record<string, unknown>)
          }
        }
      }),
      isDirty: true
    }))
  })

  useWorkflowStore.setState({ updateNodeData })
  return updateNodeData
}

const findParamsCall = (mock: ReturnType<typeof vi.fn>) =>
  [...mock.mock.calls]
    .reverse()
    .find((call) =>
      Boolean(
        call?.[0] === nodeId && call?.[1] && 'params' in (call?.[1] || {})
      )
    )

describe('WebhookAction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useWorkflowStore.setState((state) => ({
      ...state,
      nodes: [],
      edges: [],
      isDirty: false,
      canEdit: true
    }))
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    useWorkflowStore.setState((state) => ({
      ...state,
      nodes: [],
      edges: [],
      isDirty: false,
      canEdit: true
    }))
    vi.restoreAllMocks()
  })

  it('emits a merged payload when switching HTTP methods', async () => {
    const updateNodeData = seedWebhookNode(
      createBaseParams({ bodyType: 'json', body: '{"id":1}' })
    )

    render(<WebhookAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: true
      })
    })

    const methodButton = screen.getByRole('button', { name: 'GET' })
    fireEvent.click(methodButton)

    const postOption = await screen.findByText('POST')
    fireEvent.click(postOption)

    await waitFor(() => {
      expect(
        updateNodeData.mock.calls.some(
          ([id, payload]) =>
            id === nodeId &&
            Boolean(
              payload &&
                'params' in payload &&
                (payload as { params: WebhookActionParams }).params.method ===
                  'POST'
            )
        )
      ).toBe(true)
    })

    const paramsCall = findParamsCall(updateNodeData)
    expect(paramsCall?.[1]).toMatchObject({
      params: {
        method: 'POST',
        bodyType: 'json',
        body: '{"id":1}'
      },
      dirty: true
    })
  })

  it('retains existing auth params when updating the username', async () => {
    const updateNodeData = seedWebhookNode(
      createBaseParams({
        authType: 'basic',
        authUsername: 'initial',
        authPassword: 'secret',
        url: 'https://hooks.example.com'
      })
    )

    render(<WebhookAction nodeId={nodeId} />)

    const usernameInput = await screen.findByPlaceholderText('Username')

    act(() => {
      fireEvent.change(usernameInput, { target: { value: 'alice' } })
      vi.advanceTimersByTime(250)
    })

    await waitFor(() => {
      expect(
        updateNodeData.mock.calls.some(
          ([id, payload]) =>
            id === nodeId &&
            Boolean(
              payload &&
                'params' in payload &&
                (payload as { params: WebhookActionParams }).params
                  .authUsername === 'alice'
            )
        )
      ).toBe(true)
    })

    const paramsCall = findParamsCall(updateNodeData)
    expect(paramsCall?.[1]).toMatchObject({
      params: {
        url: 'https://hooks.example.com',
        authType: 'basic',
        authUsername: 'alice',
        authPassword: 'secret'
      },
      dirty: true
    })
  })

  it('resolves validation errors when required fields are filled', async () => {
    const updateNodeData = seedWebhookNode(createBaseParams())

    render(<WebhookAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: true
      })
    })

    const urlInput = screen.getByPlaceholderText('Request URL')
    const methodButton = screen.getByRole('button', { name: 'GET' })

    act(() => {
      fireEvent.change(urlInput, {
        target: { value: 'https://hooks.example.com/submit' }
      })
      vi.advanceTimersByTime(250)
    })

    fireEvent.click(methodButton)
    const postOption = await screen.findByText('POST')
    fireEvent.click(postOption)

    const bodyField = await screen.findByPlaceholderText('Request Body')

    act(() => {
      fireEvent.change(bodyField, { target: { value: '{"ok":true}' } })
      vi.advanceTimersByTime(750)
    })

    await waitFor(() => {
      expect(
        updateNodeData.mock.calls.some(
          ([id, payload]) =>
            id === nodeId &&
            Boolean(
              payload &&
                'params' in payload &&
                (payload as { params: WebhookActionParams }).params.body ===
                  '{"ok":true}'
            )
        )
      ).toBe(true)
    })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: false
      })
    })
  })
})

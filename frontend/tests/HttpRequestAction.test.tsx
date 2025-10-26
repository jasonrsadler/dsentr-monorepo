import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import HttpRequestAction from '../src/components/workflow/Actions/HttpRequestAction'
import type { HttpRequestActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

const nodeId = 'http-node'

const createBaseParams = (
  overrides: Partial<HttpRequestActionParams> = {}
): HttpRequestActionParams => ({
  url: '',
  method: 'GET',
  headers: [],
  queryParams: [],
  bodyType: 'raw',
  body: '',
  formBody: [],
  timeout: 0,
  followRedirects: true,
  authType: 'none',
  username: '',
  password: '',
  token: '',
  dirty: false,
  ...overrides
})

const seedHttpNode = (params: HttpRequestActionParams) => {
  useWorkflowStore.setState((state) => ({
    ...state,
    nodes: [
      {
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          label: 'HTTP Request',
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

describe('HttpRequestAction', () => {
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

  it('updates the url param while preserving other fields and marking the node dirty', async () => {
    const initial = createBaseParams({
      method: 'POST',
      headers: [{ key: 'Authorization', value: 'Bearer 123' }],
      queryParams: [{ key: 'page', value: '1' }],
      followRedirects: false
    })
    const updateNodeData = seedHttpNode(initial)

    render(<HttpRequestAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: true
      })
    })

    const urlInput = screen.getByPlaceholderText('Request URL')

    act(() => {
      fireEvent.change(urlInput, {
        target: { value: 'https://example.com/posts' }
      })
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
              (payload as { params: HttpRequestActionParams }).params.url ===
              'https://example.com/posts'
            )
        )
      ).toBe(true)
    })

    const paramsCall = findParamsCall(updateNodeData)
    expect(paramsCall?.[1]).toMatchObject({
      params: {
        url: 'https://example.com/posts',
        method: 'POST',
        headers: initial.headers,
        queryParams: initial.queryParams,
        followRedirects: false
      },
      dirty: true
    })
  })

  it('preserves existing request data when header key is edited', async () => {
    const initial = createBaseParams({
      url: 'https://api.example.com/data',
      headers: [{ key: 'X-Request-ID', value: '123' }],
      queryParams: [{ key: 'include', value: 'meta' }]
    })
    const updateNodeData = seedHttpNode(initial)

    render(<HttpRequestAction nodeId={nodeId} />)

    await screen.findByText('Headers')

    const headerKeyInput = screen.getAllByPlaceholderText('key')[0]

    act(() => {
      fireEvent.change(headerKeyInput, { target: { value: 'X-Trace-ID' } })
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
              (payload as { params: HttpRequestActionParams }).params
                .headers?.[0]?.key === 'X-Trace-ID'
            )
        )
      ).toBe(true)
    })

    const paramsCall = findParamsCall(updateNodeData)
    expect(paramsCall?.[1]).toMatchObject({
      params: {
        url: 'https://api.example.com/data',
        method: 'GET',
        headers: [{ key: 'X-Trace-ID', value: '123' }],
        queryParams: initial.queryParams
      },
      dirty: true
    })
  })

  it('clears validation errors once the request becomes valid', async () => {
    const updateNodeData = seedHttpNode(createBaseParams())

    render(<HttpRequestAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: true
      })
    })

    const urlInput = screen.getByPlaceholderText('Request URL')

    act(() => {
      fireEvent.change(urlInput, {
        target: { value: 'https://valid.example.com' }
      })
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
              (payload as { params: HttpRequestActionParams }).params.url ===
              'https://valid.example.com'
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

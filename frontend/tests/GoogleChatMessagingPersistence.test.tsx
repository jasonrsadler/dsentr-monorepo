import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import GoogleChatAction from '../src/components/workflow/Actions/Messaging/Services/GoogleChatAction'
import { useWorkflowStore } from '@/stores/workflowStore'

vi.mock('@/components/UI/InputFields/NodeInputField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder }: any) => (
    <input
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('@/components/UI/InputFields/NodeTextAreaField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder, rows }: any) => (
    <textarea
      placeholder={placeholder}
      value={value ?? ''}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('@/components/UI/InputFields/NodeDropdownField', () => ({
  __esModule: true,
  default: ({ value, onChange, options }: any) => {
    const normalized = (options as any[]).map((option) =>
      typeof option === 'string' ? { label: option, value: option } : option
    )

    return (
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {normalized.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }
}))

type GoogleChatParams = Record<string, unknown>

const createParams = (): GoogleChatParams => ({
  webhookUrl: 'https://chat.googleapis.com/v1/webhook',
  message: 'Hello from Google Chat',
  cardJson: ''
})

describe('GoogleChatAction messaging persistence', () => {
  const nodeId = 'google-chat-node'
  let updateNodeData: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const initialParams = createParams()
    useWorkflowStore.setState((state) => ({
      ...state,
      nodes: [
        {
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            label: 'Messaging',
            params: initialParams,
            dirty: false,
            hasValidationErrors: false
          }
        } as any
      ],
      edges: [],
      isDirty: false,
      canEdit: true
    }))
    updateNodeData = vi.fn((id: string, payload: unknown) => {
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
  })

  afterEach(() => {
    useWorkflowStore.setState((state) => ({
      ...state,
      nodes: [],
      edges: [],
      isDirty: false,
      canEdit: true
    }))
    vi.restoreAllMocks()
  })

  it('emits updated Google Chat params without extraneous fields', async () => {
    render(<GoogleChatAction nodeId={nodeId} />)

    expect(updateNodeData).not.toHaveBeenCalled()

    const messageField = await screen.findByPlaceholderText('Message')
    fireEvent.change(messageField, {
      target: { value: 'Updated Google Chat payload' }
    })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const paramsCall = [...updateNodeData.mock.calls]
      .reverse()
      .find((call) =>
        Boolean(
          call?.[0] === nodeId &&
          call?.[1] &&
          'params' in (call?.[1] as Record<string, unknown>)
        )
      )

    expect(paramsCall?.[1]).toMatchObject({
      params: expect.objectContaining({
        message: 'Updated Google Chat payload',
        webhookUrl: 'https://chat.googleapis.com/v1/webhook',
        cardJson: ''
      }),
      dirty: true,
      hasValidationErrors: false
    })
  })

  it('tracks validation state as the Google Chat payload is fixed', async () => {
    render(<GoogleChatAction nodeId={nodeId} />)

    const messageField = await screen.findByPlaceholderText('Message')
    fireEvent.change(messageField, { target: { value: '' } })

    await waitFor(() => {
      expect(
        updateNodeData.mock.calls.some(
          ([id, payload]) =>
            id === nodeId && Boolean(payload?.hasValidationErrors === true)
        )
      ).toBe(true)
    })

    fireEvent.change(messageField, {
      target: { value: 'Restored Google Chat payload' }
    })

    await waitFor(() => {
      expect(
        updateNodeData.mock.calls.some(
          ([id, payload]) =>
            id === nodeId && Boolean(payload?.hasValidationErrors === false)
        )
      ).toBe(true)
    })
  })
})

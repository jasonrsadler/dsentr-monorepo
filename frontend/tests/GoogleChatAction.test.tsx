import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import GoogleChatAction from '@/components/workflow/Actions/Messaging/Services/GoogleChatAction'

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

type MessagingParams = Record<string, unknown>

const createBaseParams = (): MessagingParams => ({
  'Google Chat': {
    webhookUrl: 'https://chat.googleapis.com/v1/webhook',
    message: 'Hello Chat',
    cardJson: ''
  }
})
const mockParamsRef = { current: createBaseParams() }

const updateNodeData = vi.fn()
const workflowState = {
  canEdit: true,
  updateNodeData
}

vi.mock('@/stores/workflowSelectors', () => ({
  useActionParams: () => mockParamsRef.current
}))

vi.mock('@/stores/workflowStore', () => {
  const useWorkflowStore = (selector: (state: typeof workflowState) => any) =>
    selector(workflowState)

  useWorkflowStore.setState = (partial: any) => {
    if (typeof partial === 'function') {
      Object.assign(workflowState, partial(workflowState))
    } else {
      Object.assign(workflowState, partial)
    }
  }

  useWorkflowStore.getState = () => workflowState

  return { useWorkflowStore }
})

describe('GoogleChatAction (workflow store integration)', () => {
  const nodeId = 'google-chat-node'

  const resetState = () => {
    mockParamsRef.current = createBaseParams()
    workflowState.canEdit = true
    updateNodeData.mockClear()
  }

  beforeEach(() => {
    resetState()
  })

  it('writes to the workflow store when message content changes', async () => {
    render(<GoogleChatAction nodeId={nodeId} />)

    expect(updateNodeData).not.toHaveBeenCalled()

    const messageField = await screen.findByPlaceholderText('Message')
    fireEvent.change(messageField, {
      target: { value: 'Updated Chat Message' }
    })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const lastCall = updateNodeData.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe(nodeId)
    expect(lastCall?.[1]).toMatchObject({
      dirty: true,
      hasValidationErrors: false
    })
    expect(lastCall?.[1].params).toMatchObject({
      'Google Chat': {
        webhookUrl: 'https://chat.googleapis.com/v1/webhook',
        message: 'Updated Chat Message',
        cardJson: ''
      },
      webhookUrl: 'https://chat.googleapis.com/v1/webhook',
      message: 'Updated Chat Message',
      cardJson: ''
    })
  })

  it('reports validation errors when the webhook URL is cleared', async () => {
    render(<GoogleChatAction nodeId={nodeId} />)

    expect(updateNodeData).not.toHaveBeenCalled()

    const webhookField = await screen.findByPlaceholderText('Webhook URL')
    fireEvent.change(webhookField, { target: { value: '' } })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const patchCall = updateNodeData.mock.calls.find(
      ([, payload]) => payload.params
    )
    expect(patchCall).toBeDefined()
    expect(patchCall?.[0]).toBe(nodeId)
    expect(patchCall?.[1]).toMatchObject({
      hasValidationErrors: true,
      dirty: true
    })
    expect(patchCall?.[1].params).toMatchObject({
      'Google Chat': {
        webhookUrl: '',
        message: 'Hello Chat',
        cardJson: ''
      },
      webhookUrl: '',
      message: 'Hello Chat',
      cardJson: ''
    })
  })

  it.fails(
    'emits minimal patches for message updates with validation state',
    async () => {
      render(<GoogleChatAction nodeId={nodeId} />)

      await waitFor(() => {
        expect(updateNodeData).toHaveBeenCalled()
      })

      updateNodeData.mockClear()

      const messageField = await screen.findByPlaceholderText('Message')
      fireEvent.change(messageField, {
        target: { value: 'Updated Chat Message' }
      })

      await waitFor(() => {
        expect(updateNodeData).toHaveBeenCalled()
      })

      const patchCall = updateNodeData.mock.calls.find(
        ([, payload]) => payload.params
      )
      expect(patchCall?.[1]).toEqual({
        params: { 'Google Chat': { message: 'Updated Chat Message' } },
        dirty: true,
        hasValidationErrors: false
      })
    }
  )

  it.fails(
    'persists cardsV2 drafts via minimal patches when toggling modes',
    async () => {
      mockParamsRef.current = {
        'Google Chat': {
          webhookUrl: 'https://chat.googleapis.com/v1/webhook',
          message: '',
          cardJson: '{"cardsV2":[{"sections":[]}]}'
        }
      }

      render(<GoogleChatAction nodeId={nodeId} />)

      await waitFor(() => {
        expect(updateNodeData).toHaveBeenCalled()
      })

      updateNodeData.mockClear()

      const modeSelect = await screen.findByDisplayValue('Card JSON (cardsV2)')
      fireEvent.change(modeSelect, { target: { value: 'Text message' } })

      await waitFor(() => {
        expect(updateNodeData).toHaveBeenCalled()
      })

      updateNodeData.mockClear()

      fireEvent.change(modeSelect, { target: { value: 'Card JSON (cardsV2)' } })

      await waitFor(() => {
        expect(updateNodeData).toHaveBeenCalled()
      })

      const patchCall = updateNodeData.mock.calls.find(
        ([, payload]) => payload.params
      )
      expect(patchCall?.[1]).toEqual({
        params: {
          'Google Chat': {
            cardJson: '{"cardsV2":[{"sections":[]}]}',
            message: ''
          }
        },
        dirty: true,
        hasValidationErrors: false
      })
    }
  )
})

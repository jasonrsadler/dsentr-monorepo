import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import SlackAction from '../src/components/workflow/Actions/Messaging/Services/SlackAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'
import { useAuth } from '@/stores/auth'

vi.mock('@/components/ui/InputFields/NodeInputField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder }: any) => (
    <input
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('@/components/ui/InputFields/NodeDropdownField', () => ({
  __esModule: true,
  default: ({ value, onChange, options, placeholder }: any) => {
    const flatOptions = (options as any[]).flatMap((entry) => {
      if (entry && typeof entry === 'object' && 'options' in entry) {
        return (entry.options as any[]) ?? []
      }
      return [entry]
    })

    return (
      <select
        aria-label={placeholder ?? 'dropdown'}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {flatOptions.map((option) => {
          const normalized =
            typeof option === 'string'
              ? { label: option, value: option }
              : option
          return (
            <option key={normalized.value} value={normalized.value}>
              {normalized.label}
            </option>
          )
        })}
      </select>
    )
  }
}))

vi.mock('@/components/ui/InputFields/NodeSecretDropdown', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) => (
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Manual entry</option>
      <option value="primary">primary</option>
    </select>
  )
}))

const createBaseParams = () => ({
  channel: '#alerts',
  message: 'Hello team',
  token: 'xoxb-token',
  connectionScope: '',
  connectionId: '',
  accountEmail: ''
})

const mockParamsRef = { current: createBaseParams() }
const updateNodeData = vi.fn((id: string, patch: any) => {
  const node = workflowState.nodes.find((entry) => entry.id === id)
  if (!node) return
  if (!patch || typeof patch !== 'object') return
  const data =
    node.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? { ...(node.data as Record<string, unknown>) }
      : {}
  if (patch.params && typeof patch.params === 'object') {
    data.params = patch.params
  }
  node.data = data
})
const workflowState = {
  canEdit: true,
  updateNodeData,
  nodes: [
    {
      id: 'slack-node',
      data: { params: mockParamsRef.current }
    }
  ],
  edges: []
}

const fetchConnections = vi.fn().mockResolvedValue({
  personal: [
    {
      scope: 'personal',
      provider: 'slack',
      connected: true,
      id: 'conn-1',
      accountEmail: 'alice@example.com',
      requiresReconnect: false,
      isShared: false
    }
  ],
  workspace: []
})
const getCachedConnections = vi.fn().mockReturnValue(null)
const subscribeToConnectionUpdates = vi.fn().mockReturnValue(() => {})

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

vi.mock('@/lib/oauthApi', () => ({
  fetchConnections: (...args: any[]) => fetchConnections(...args),
  getCachedConnections: (...args: any[]) => getCachedConnections(...args),
  subscribeToConnectionUpdates: (...args: any[]) =>
    subscribeToConnectionUpdates(...args)
}))

describe('SlackAction (workflow store integration)', () => {
  const nodeId = 'slack-node'
  const secrets = {
    messaging: {
      slack: {
        primary: 'xoxb-token'
      }
    }
  }

  const initialAuthState = useAuth.getState()

  const resetState = () => {
    mockParamsRef.current = createBaseParams()
    workflowState.nodes = [
      {
        id: nodeId,
        data: { params: mockParamsRef.current }
      }
    ]
    workflowState.edges = []
    workflowState.canEdit = true
    updateNodeData.mockClear()
    fetchConnections.mockClear()
    fetchConnections.mockResolvedValue({
      personal: [
        {
          scope: 'personal',
          provider: 'slack',
          connected: true,
          id: 'conn-1',
          accountEmail: 'alice@example.com',
          requiresReconnect: false,
          isShared: false
        }
      ],
      workspace: []
    })
  }

  beforeEach(() => {
    resetState()
    useAuth.setState(initialAuthState, true)
  })

  it('writes to the workflow store when the Slack channel changes', async () => {
    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    const channelInput = await screen.findByPlaceholderText(
      'Channel (e.g. #general)'
    )
    fireEvent.change(channelInput, { target: { value: '#ops' } })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const lastCall = updateNodeData.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe(nodeId)
    expect(lastCall?.[1]).toMatchObject({
      dirty: true,
      hasValidationErrors: false
    })
  })

  it('propagates validation errors when the message is cleared', async () => {
    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    const messageInput = await screen.findByPlaceholderText('Message')
    fireEvent.change(messageInput, { target: { value: '' } })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const lastCall = updateNodeData.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe(nodeId)
    expect(lastCall?.[1]).toMatchObject({
      dirty: true,
      hasValidationErrors: true
    })
  })

  it('emits updated Slack payloads without dropping existing fields', async () => {
    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    const channelInput = await screen.findByPlaceholderText(
      'Channel (e.g. #general)'
    )
    fireEvent.change(channelInput, { target: { value: '#ops' } })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const patchCall = updateNodeData.mock.calls.find(
      ([, payload]) => payload.params
    )
    expect(patchCall?.[1]).toEqual({
      params: {
        channel: '#ops',
        message: 'Hello team',
        token: 'xoxb-token',
        connectionScope: '',
        connectionId: '',
        accountEmail: '',
        postAsUser: false
      },
      dirty: true,
      hasValidationErrors: false
    })
  })

  it('merges connection updates into the full Slack payload', async () => {
    fetchConnections.mockResolvedValue({
      personal: [
        {
          scope: 'personal',
          provider: 'slack',
          connected: true,
          id: 'conn-2',
          accountEmail: 'carol@example.com',
          requiresReconnect: false,
          isShared: false
        }
      ],
      workspace: []
    })

    mockParamsRef.current = {
      channel: '#alerts',
      message: 'Hello team',
      token: '',
      connectionScope: '',
      connectionId: '',
      accountEmail: ''
    }

    workflowState.nodes = [
      {
        id: nodeId,
        data: { params: mockParamsRef.current }
      }
    ]

    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    await waitFor(() => {
      expect(fetchConnections).toHaveBeenCalled()
    })

    const dropdown = screen.getByLabelText('Select Slack connection')
    fireEvent.change(dropdown, { target: { value: 'personal:conn-2' } })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const patchCall = updateNodeData.mock.calls.find(
      ([, payload]) => payload.params
    )
    expect(patchCall?.[1]).toMatchObject({
      params: {
        channel: '#alerts',
        message: 'Hello team',
        token: '',
        connectionScope: 'user',
        connectionId: 'conn-2',
        accountEmail: 'carol@example.com',
        connection: {
          connectionScope: 'user',
          connectionId: 'conn-2',
          accountEmail: 'carol@example.com'
        }
      },
      dirty: true,
      hasValidationErrors: false
    })
  })
})

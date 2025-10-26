import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi } from 'vitest'

import TeamsAction from '../src/components/workflow/Actions/Messaging/Services/TeamsAction'
import { renderWithSecrets } from '@/test-utils/renderWithSecrets'
import { useAuth } from '@/stores/auth'
import {
  getCachedConnections,
  subscribeToConnectionUpdates,
  type ProviderConnectionSet
} from '@/lib/oauthApi'
import {
  fetchMicrosoftTeams,
  fetchMicrosoftTeamChannels,
  fetchMicrosoftChannelMembers
} from '@/lib/microsoftGraphApi'

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
  default: ({ value, onChange, placeholder }: any) => (
    <textarea
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('@/components/UI/InputFields/NodeDropdownField', () => ({
  __esModule: true,
  default: ({ value, onChange, options }: any) => {
    const normalized = (options as any[]).flatMap((entry) => {
      if (entry && typeof entry === 'object' && 'options' in entry) {
        return (entry.options as any[]).map((opt) =>
          typeof opt === 'string'
            ? { label: opt, value: opt, disabled: false }
            : { label: opt.label, value: opt.value, disabled: opt.disabled }
        )
      }
      if (typeof entry === 'string') {
        return { label: entry, value: entry, disabled: false }
      }
      return {
        label: entry.label,
        value: entry.value,
        disabled: entry.disabled
      }
    })

    return (
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {normalized.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    )
  }
}))

vi.mock('@/components/UI/InputFields/NodeSecretDropdown', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) => (
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Select header secret</option>
      <option value="existing">existing</option>
    </select>
  )
}))

type TeamsParams = Record<string, unknown>

type TeamsMeta = {
  dirty: boolean
  hasValidationErrors: boolean
}

const createBaseParams = (): TeamsParams => ({
  deliveryMethod: 'Incoming Webhook',
  webhookType: 'Connector',
  webhookUrl: '',
  message: '',
  summary: '',
  themeColor: '',
  mentions: [] as Array<{ userId: string; displayName?: string }>,
  workflowOption: 'Basic (Raw JSON)',
  workflowRawJson: '',
  workflowHeaderName: '',
  workflowHeaderSecret: '',
  oauthProvider: '',
  oauthConnectionScope: '',
  oauthConnectionId: '',
  oauthAccountEmail: '',
  cardMode: 'Simple card builder',
  cardTitle: '',
  cardBody: '',
  messageType: 'Text'
})

const mockParamsRef = { current: createBaseParams() }
const mockMetaRef = {
  current: { dirty: false, hasValidationErrors: false } as TeamsMeta
}

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
    mockParamsRef.current = patch.params as TeamsParams
  }
  node.data = data
})
const workflowState = {
  canEdit: true,
  updateNodeData,
  nodes: [
    {
      id: 'teams-node',
      data: { params: mockParamsRef.current }
    }
  ],
  edges: []
}

vi.mock('@/lib/oauthApi', () => ({
  fetchConnections: vi.fn(),
  getCachedConnections: vi.fn(),
  subscribeToConnectionUpdates: vi.fn().mockReturnValue(() => {}),
  updateCachedConnections: vi.fn()
}))

vi.mock('@/lib/microsoftGraphApi', () => ({
  fetchMicrosoftTeams: vi.fn(),
  fetchMicrosoftTeamChannels: vi.fn(),
  fetchMicrosoftChannelMembers: vi.fn()
}))

vi.mock('@/stores/workflowSelectors', () => ({
  useActionParams: () => mockParamsRef.current,
  useActionMeta: () => mockMetaRef.current
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

describe('TeamsAction (workflow store integration)', () => {
  const nodeId = 'teams-node'
  const initialAuthState = useAuth.getState()
  const secrets = {
    messaging: {
      teams: {
        existing: 'abc123'
      }
    }
  }

  const resetMocks = () => {
    mockParamsRef.current = createBaseParams()
    mockMetaRef.current = { dirty: false, hasValidationErrors: false }
    workflowState.nodes = [
      {
        id: nodeId,
        data: { params: mockParamsRef.current }
      }
    ]
    workflowState.edges = []
    workflowState.canEdit = true
    updateNodeData.mockClear()
    vi.mocked(getCachedConnections).mockReset()
    vi.mocked(getCachedConnections).mockReturnValue(null)
    vi.mocked(subscribeToConnectionUpdates).mockReset()
    vi.mocked(subscribeToConnectionUpdates).mockReturnValue(() => {})
    vi.mocked(fetchMicrosoftTeams).mockReset()
    vi.mocked(fetchMicrosoftTeams).mockResolvedValue([])
    vi.mocked(fetchMicrosoftTeamChannels).mockReset()
    vi.mocked(fetchMicrosoftTeamChannels).mockResolvedValue([])
    vi.mocked(fetchMicrosoftChannelMembers).mockReset()
    vi.mocked(fetchMicrosoftChannelMembers).mockResolvedValue([])
    act(() => {
      useAuth.setState(initialAuthState, true)
    })
  }

  beforeEach(() => {
    resetMocks()
    act(() => {
      useAuth.setState((state) => ({
        ...state,
        memberships: [
          {
            workspace: {
              id: 'ws-1',
              name: 'Workspace',
              plan: 'workspace',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              deleted_at: null,
              created_by: 'owner',
              owner_id: 'owner'
            },
            role: 'owner'
          }
        ],
        currentWorkspaceId: 'ws-1',
        isLoading: false
      }))
    })
  })

  it('emits minimal webhook patches with validation state', async () => {
    mockParamsRef.current.webhookUrl = 'https://initial.example.com'
    mockParamsRef.current.message = 'Initial message'

    renderWithSecrets(<TeamsAction nodeId={nodeId} />, { secrets })

    const webhookInput = await screen.findByPlaceholderText('Webhook URL')
    expect(webhookInput).toHaveValue('https://initial.example.com')

    updateNodeData.mockClear()

    fireEvent.change(webhookInput, {
      target: { value: 'https://updated.example.com' }
    })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const patchCall = updateNodeData.mock.calls.find(
      ([, payload]) => payload.params
    )
    expect(patchCall).toBeDefined()
    expect(patchCall?.[0]).toBe(nodeId)
    expect(patchCall?.[1]).toMatchObject({
      params: expect.objectContaining({
        webhookUrl: 'https://updated.example.com',
        message: 'Initial message'
      }),
      dirty: true,
      hasValidationErrors: false
    })
  })

  it('validates missing webhook URLs', async () => {
    mockParamsRef.current.webhookUrl = 'https://initial.example.com'
    mockParamsRef.current.message = 'Initial body'

    renderWithSecrets(<TeamsAction nodeId={nodeId} />, { secrets })

    const webhookInput = await screen.findByPlaceholderText('Webhook URL')
    expect(webhookInput).toHaveValue('https://initial.example.com')
    fireEvent.change(webhookInput, { target: { value: '' } })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const patchCall = updateNodeData.mock.calls.find(
      ([, payload]) => payload.params
    )
    expect(patchCall).toBeDefined()
    expect(patchCall?.[0]).toBe(nodeId)
    expect(patchCall?.[1]).toMatchObject({
      params: expect.objectContaining({
        webhookUrl: '',
        message: 'Initial body'
      }),
      dirty: true,
      hasValidationErrors: true
    })
  })

  it('clears workflow header credentials when switching auth modes', async () => {
    mockParamsRef.current.webhookType = 'Workflow/Power Automate'
    mockParamsRef.current.workflowOption = 'Header Secret Auth'
    mockParamsRef.current.workflowRawJson = '{"foo":"bar"}'
    mockParamsRef.current.workflowHeaderName = 'X-Secret'
    mockParamsRef.current.workflowHeaderSecret = 'existing'

    renderWithSecrets(<TeamsAction nodeId={nodeId} />, { secrets })

    const optionSelect = await screen.findByDisplayValue('Header Secret Auth')
    fireEvent.change(optionSelect, { target: { value: 'Basic (Raw JSON)' } })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    const patchCall = updateNodeData.mock.calls.find(
      ([, payload]) => payload.params
    )
    expect(patchCall?.[0]).toBe(nodeId)
    expect(patchCall?.[1]).toMatchObject({
      params: expect.objectContaining({
        workflowOption: 'Basic (Raw JSON)',
        workflowHeaderName: '',
        workflowHeaderSecret: ''
      }),
      dirty: true
    })
  })

  it('skips redundant updates when no-op patches are submitted', async () => {
    renderWithSecrets(<TeamsAction nodeId={nodeId} />, { secrets })

    const messageInput = await screen.findByPlaceholderText('Message')
    fireEvent.change(messageInput, { target: { value: 'Hello world' } })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalled()
    })

    updateNodeData.mockClear()

    fireEvent.change(messageInput, { target: { value: 'Hello world' } })

    await waitFor(() => {
      expect(updateNodeData).not.toHaveBeenCalled()
    })
  })

  it('blocks updates when restricted', async () => {
    workflowState.canEdit = true
    renderWithSecrets(<TeamsAction nodeId={nodeId} isRestricted />, { secrets })

    const initialCalls = updateNodeData.mock.calls.length

    const messageInput = await screen.findByPlaceholderText('Message')
    fireEvent.change(messageInput, { target: { value: 'Updated message' } })

    await waitFor(() => {
      expect(updateNodeData.mock.calls.length).toBe(initialCalls)
    })
  })

  it('stabilizes delegated workspace credentials without redundant updates', async () => {
    const delegatedParams = createBaseParams()
    Object.assign(delegatedParams, {
      deliveryMethod: 'Delegated OAuth (Post as user)',
      messageType: 'Text',
      cardMode: 'Simple card builder',
      oauthProvider: 'microsoft',
      oauthConnectionScope: 'workspace',
      oauthConnectionId: 'workspace-123',
      oauthAccountEmail: 'delegate@example.com',
      connection: {
        connectionScope: 'workspace',
        connectionId: 'workspace-123',
        accountEmail: 'delegate@example.com'
      }
    })

    mockParamsRef.current = delegatedParams
    workflowState.nodes = [
      {
        id: nodeId,
        data: { params: mockParamsRef.current }
      }
    ]

    const microsoftConnections: ProviderConnectionSet = {
      personal: {
        scope: 'personal',
        id: 'microsoft',
        connected: true,
        accountEmail: 'delegate@example.com',
        expiresAt: undefined,
        lastRefreshedAt: undefined,
        requiresReconnect: false,
        isShared: false
      },
      workspace: [
        {
          scope: 'workspace',
          id: 'workspace-123',
          connected: true,
          accountEmail: 'delegate@example.com',
          expiresAt: undefined,
          lastRefreshedAt: undefined,
          requiresReconnect: false,
          provider: 'microsoft',
          workspaceId: 'ws-1',
          workspaceName: 'Workspace',
          sharedByName: 'Owner',
          sharedByEmail: 'owner@example.com'
        }
      ]
    }

    vi.mocked(getCachedConnections).mockReturnValue({
      microsoft: microsoftConnections
    } as any)

    renderWithSecrets(<TeamsAction nodeId={nodeId} />, { secrets })

    await screen.findByPlaceholderText('Message')
    await act(async () => {
      await Promise.resolve()
    })

    const paramsCalls = updateNodeData.mock.calls.filter(([, payload]) =>
      Boolean(payload && typeof payload === 'object' && 'params' in payload)
    )
    expect(paramsCalls).toHaveLength(0)
  })
})

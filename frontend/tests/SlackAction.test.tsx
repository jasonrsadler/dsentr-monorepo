import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, beforeEach, vi, expect } from 'vitest'

import SlackAction from '../src/components/workflow/Actions/Messaging/Services/SlackAction'
import { renderWithSecrets } from '../src/test-utils/renderWithSecrets'

/* ============================
   API mocks
============================ */

const paramsStore = vi.hoisted(() => ({
  paramsRef: { current: {} as any },
  listeners: new Set<() => void>()
}))

const fetchConnections = vi.fn()
const getCachedConnections = vi.fn()
const subscribeToConnectionUpdates = vi.fn()
const fetchSlackChannels = vi.fn()

vi.mock('@/lib/oauthApi', () => ({
  fetchConnections: (...args: any[]) => fetchConnections(...args),
  getCachedConnections: (...args: any[]) => getCachedConnections(...args),
  subscribeToConnectionUpdates: (...args: any[]) =>
    subscribeToConnectionUpdates(...args)
}))

vi.mock('@/lib/slackApi', () => ({
  fetchSlackChannels: (...args: any[]) => fetchSlackChannels(...args)
}))

/* ============================
   UI field mocks
============================ */

vi.mock('@/components/ui/InputFields/NodeInputField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder }: any) => (
    <input
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}))

vi.mock('@/components/ui/InputFields/NodeDropdownField', () => ({
  __esModule: true,
  default: ({ value, onChange, options }: any) => {
    const flat = (options ?? []).flatMap((o: any) =>
      o?.options ? o.options : [o]
    )
    return (
      <select
        aria-label="dropdown"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" />
        {flat.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
}))

/* ============================
   Store mocks (ONCE)
============================ */

const notifyParams = () => {
  paramsStore.listeners.forEach((listener) => listener())
}

const updateNodeData = vi.fn((nodeId: string, data: any) => {
  // Actually update the params so the component re-renders with new data
  if (data.params) {
    paramsStore.paramsRef.current = {
      ...paramsStore.paramsRef.current,
      ...data.params
    }
    notifyParams()
  }
})

const workflowState = {
  canEdit: true,
  updateNodeData,
  nodes: [] as any[],
  edges: [] as any[]
}

vi.mock('@/stores/workflowStore', () => {
  const useWorkflowStore = (selector: any) => selector(workflowState)
  useWorkflowStore.getState = () => workflowState
  useWorkflowStore.setState = (partial: any) => {
    Object.assign(
      workflowState,
      typeof partial === 'function' ? partial(workflowState) : partial
    )
  }
  return { useWorkflowStore }
})

vi.mock('@/stores/workflowSelectors', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useActionParams: () => {
      const subscribe = (listener: () => void) => {
        paramsStore.listeners.add(listener)
        return () => {
          paramsStore.listeners.delete(listener)
        }
      }
      const getSnapshot = () => paramsStore.paramsRef.current
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }
  }
})

vi.mock('@/stores/auth', () => ({
  useAuth: (selector: any) =>
    selector({ currentWorkspace: { workspace: { id: 'ws-1' } } }),
  selectCurrentWorkspace: (s: any) => s.currentWorkspace
}))

/* ============================
   Helpers
============================ */

const nodeId = 'node-1'
const secrets = {}

const baseParams = () => ({
  channel: '',
  message: '',
  identity: 'workspace_bot' as const,
  workspace_connection_id: undefined,
  personal_connection_id: undefined
})

const reset = () => {
  paramsStore.paramsRef.current = baseParams()
  workflowState.nodes = [
    { id: nodeId, data: { params: paramsStore.paramsRef.current } }
  ]
  updateNodeData.mockClear()
  fetchConnections.mockReset()
  getCachedConnections.mockReset()
  subscribeToConnectionUpdates.mockReset()
  fetchSlackChannels.mockReset()

  // Set default return values
  getCachedConnections.mockReturnValue(null)
  subscribeToConnectionUpdates.mockReturnValue(() => {}) // unsubscribe function
}

/* ============================
   Tests
============================ */

describe('SlackAction identity enforcement and backend contract', () => {
  beforeEach(reset)

  /* ---------- identity required ---------- */

  it('defaults to workspace_bot and requires a workspace connection', async () => {
    fetchConnections.mockResolvedValue({ workspace: [], personal: [] })

    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    fireEvent.change(await screen.findByPlaceholderText('Message'), {
      target: { value: 'hi' }
    })

    expect(updateNodeData).toHaveBeenCalled()
    const [, payload] = updateNodeData.mock.calls.at(-1)!
    expect(payload.hasValidationErrors).toBe(true)
    expect(payload.params.identity).toBe('workspace_bot')
    expect(payload.params.workspace_connection_id).toBeUndefined()
    expect(payload.params.personal_connection_id).toBeUndefined()
    expect(fetchSlackChannels).not.toHaveBeenCalled()
  })

  /* ---------- workspace bot ---------- */

  it('workspace_bot requires workspace connection', async () => {
    paramsStore.paramsRef.current = {
      ...baseParams(),
      identity: 'workspace_bot'
    }

    fetchConnections.mockResolvedValue({ workspace: [], personal: [] })

    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    expect(updateNodeData).not.toHaveBeenCalled()
    expect(fetchSlackChannels).not.toHaveBeenCalled()
  })

  /* ---------- personal user ---------- */

  it('personal_user requires BOTH connections', async () => {
    paramsStore.paramsRef.current = {
      ...baseParams(),
      identity: 'personal_user'
    }

    fetchConnections.mockResolvedValue({
      workspace: [],
      personal: [
        {
          scope: 'personal',
          provider: 'slack',
          id: 'user-conn',
          connected: true,
          requiresReconnect: false,
          isShared: false
        }
      ]
    })

    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    expect(updateNodeData).not.toHaveBeenCalled()
    expect(fetchSlackChannels).not.toHaveBeenCalled()
  })

  /* ---------- regressions ---------- */

  it('does not infer identity from connections', async () => {
    fetchConnections.mockResolvedValue({
      workspace: [
        { scope: 'workspace', provider: 'slack', id: 'ws', connected: true }
      ],
      personal: [
        { scope: 'personal', provider: 'slack', id: 'user', connected: true }
      ]
    })

    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    expect(updateNodeData).not.toHaveBeenCalled()
    expect(fetchSlackChannels).not.toHaveBeenCalled()
  })

  it('never emits token or legacy auth fields', async () => {
    paramsStore.paramsRef.current = {
      ...baseParams(),
      token: 'xoxb-legacy',
      connectionScope: 'manual'
    }

    fetchConnections.mockResolvedValue({ workspace: [], personal: [] })

    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it('workspace_bot emits ONLY workspace_connection_id', async () => {
    const mockConnections = {
      personal: [],
      workspace: [
        {
          scope: 'workspace',
          provider: 'slack',
          id: 'ws-conn',
          connected: true,
          accountEmail: 'team@example.com',
          requiresReconnect: false,
          isShared: true
        }
      ]
    }

    getCachedConnections.mockReturnValue(mockConnections)
    fetchConnections.mockResolvedValue(mockConnections)
    subscribeToConnectionUpdates.mockReturnValue(() => {})

    fetchSlackChannels.mockResolvedValue([
      { id: 'C123', name: 'general', isPrivate: false }
    ])

    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    // identity
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'workspace_bot' }
    })

    // workspace connection dropdown appears after identity
    // wait for workspace option to appear
    await waitFor(() => {
      expect(
        screen.getByRole('option', {
          name: /team@example.com/i
        })
      ).toBeInTheDocument()
    })

    const workspaceSelect = screen.getAllByRole('combobox')[1]

    fireEvent.change(workspaceSelect, {
      target: { value: 'workspace:ws-conn' }
    })

    await waitFor(() =>
      expect(fetchSlackChannels).toHaveBeenCalledWith({
        workspaceConnectionId: 'ws-conn'
      })
    )

    const last = updateNodeData.mock.calls.at(-1)![1].params

    expect(last.workspace_connection_id).toBe('ws-conn')
    expect(last.personal_connection_id).toBeUndefined()
  })

  it('personal_user emits BOTH ids and fetches channels with workspace only', async () => {
    const mockConnections = {
      personal: [
        {
          scope: 'personal',
          provider: 'slack',
          id: 'user-conn',
          connected: true,
          accountEmail: 'me@example.com',
          requiresReconnect: false,
          isShared: false
        }
      ],
      workspace: [
        {
          scope: 'workspace',
          provider: 'slack',
          id: 'ws-conn',
          connected: true,
          accountEmail: 'team@example.com',
          requiresReconnect: false,
          isShared: true
        }
      ]
    }

    getCachedConnections.mockReturnValue(mockConnections)
    fetchConnections.mockResolvedValue(mockConnections)
    subscribeToConnectionUpdates.mockReturnValue(() => {})

    fetchSlackChannels.mockResolvedValue([
      { id: 'C123', name: 'general', isPrivate: false }
    ])

    renderWithSecrets(<SlackAction nodeId={nodeId} />, { secrets })

    // identity
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'personal_user' }
    })

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /team@example.com/i })
      ).toBeInTheDocument()
    })

    const dropdowns = screen.getAllByRole('combobox')

    const workspaceSelect = dropdowns[1]
    fireEvent.change(workspaceSelect, {
      target: { value: 'workspace:ws-conn' }
    })

    // personal dropdown appears after workspace selection
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /me@example.com/i })
      ).toBeInTheDocument()
    })

    await waitFor(() =>
      expect(fetchSlackChannels).toHaveBeenCalledWith({
        workspaceConnectionId: 'ws-conn'
      })
    )

    const channelFetchCalls = fetchSlackChannels.mock.calls.length

    const personalSelect = screen.getAllByRole('combobox')[3]
    fireEvent.change(personalSelect, {
      target: { value: 'personal:user-conn' }
    })

    expect(fetchSlackChannels).toHaveBeenCalledTimes(channelFetchCalls)

    const last = updateNodeData.mock.calls.at(-1)![1].params

    expect(last.workspace_connection_id).toBe('ws-conn')
    expect(last.personal_connection_id).toBe('user-conn')
  })
})

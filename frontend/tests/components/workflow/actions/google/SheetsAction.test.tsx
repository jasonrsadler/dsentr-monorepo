import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import SheetsAction from '@/components/workflow/Actions/Google/SheetsAction'
import { updateCachedConnections } from '@/lib/oauthApi'
import { useAuth } from '@/stores/auth'

const createJsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

const googlePersonalPayload = {
  id: 'google-personal',
  provider: 'google' as const,
  accountEmail: 'owner@example.com',
  expiresAt: '2025-01-01T00:00:00.000Z',
  isShared: false,
  lastRefreshedAt: null,
  requiresReconnect: false
}

const googleWorkspacePayload = {
  id: 'google-workspace',
  provider: 'google' as const,
  accountEmail: 'ops@example.com',
  expiresAt: '2025-01-01T00:00:00.000Z',
  workspaceId: 'ws-1',
  workspaceName: 'Operations',
  sharedByName: 'Team Admin',
  sharedByEmail: 'admin@example.com',
  lastRefreshedAt: null,
  requiresReconnect: false
}

const buildGoogleConnections = (includeWorkspace: boolean) => ({
  personal: {
    scope: 'personal' as const,
    id: 'google-personal',
    connected: true,
    accountEmail: 'owner@example.com',
    expiresAt: '2025-01-01T00:00:00.000Z',
    lastRefreshedAt: undefined,
    requiresReconnect: false,
    isShared: includeWorkspace
  },
  workspace: includeWorkspace
    ? [
        {
          scope: 'workspace' as const,
          id: 'google-workspace',
          connected: true,
          accountEmail: 'ops@example.com',
          expiresAt: '2025-01-01T00:00:00.000Z',
          workspaceId: 'ws-1',
          workspaceName: 'Operations',
          sharedByName: 'Team Admin',
          sharedByEmail: 'admin@example.com',
          requiresReconnect: false
        }
      ]
    : []
})

const buildConnectionMap = (includeWorkspace: boolean) => ({
  google: (() => {
    const google = buildGoogleConnections(includeWorkspace)
    return {
      personal: { ...google.personal },
      workspace: google.workspace.map((entry) => ({ ...entry }))
    }
  })(),
  microsoft: { personal: null, workspace: [] }
})

const initialAuthState = useAuth.getState()

const workspaceMembership = {
  workspace: {
    id: 'ws-1',
    name: 'Acme Workspace',
    plan: 'workspace',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    created_by: 'owner',
    owner_id: 'owner'
  },
  role: 'owner' as const
}

const createBaseParams = () => ({
  dirty: false,
  spreadsheetId: 'sheet-id',
  worksheet: 'Sheet1',
  columns: [{ key: 'A', value: 'value' }],
  accountEmail: '',
  oauthConnectionScope: '',
  oauthConnectionId: ''
})

const mockParamsRef = { current: createBaseParams() }
const validationStateRef = { current: false }

const updateNodeData = vi.fn((_id: string, patch: Record<string, unknown>) => {
  if (patch.params && typeof patch.params === 'object') {
    mockParamsRef.current = {
      ...mockParamsRef.current,
      ...(patch.params as Record<string, unknown>)
    }
  }

  if (patch.dirty !== undefined) {
    mockParamsRef.current = {
      ...mockParamsRef.current,
      dirty: Boolean(patch.dirty)
    }
  }

  if (patch.hasValidationErrors !== undefined) {
    validationStateRef.current = Boolean(patch.hasValidationErrors)
  }
})

const workflowState = {
  canEdit: true,
  updateNodeData
}

vi.mock('@/stores/workflowSelectors', () => ({
  useSheetsActionParams: () => mockParamsRef.current
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

describe('SheetsAction', () => {
  const nodeId = 'sheets-node'

  beforeEach(() => {
    mockParamsRef.current = createBaseParams()
    validationStateRef.current = false
    workflowState.canEdit = true
    updateNodeData.mockClear()

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        memberships: [workspaceMembership],
        currentWorkspaceId: workspaceMembership.workspace.id
      }))
    })

    act(() => {
      updateCachedConnections(() => null)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()

    act(() => {
      updateCachedConnections(() => null)
    })

    act(() => {
      useAuth.setState(initialAuthState, true)
    })
  })

  it('selects the personal connection when available', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [googlePersonalPayload],
        workspace: [googleWorkspacePayload]
      })
    )

    render(<SheetsAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(mockParamsRef.current.accountEmail).toBe('owner@example.com')
      expect(mockParamsRef.current.oauthConnectionScope).toBe('personal')
      expect(mockParamsRef.current.oauthConnectionId).toBe('google-personal')
      expect(updateNodeData).toHaveBeenCalledWith(
        nodeId,
        expect.objectContaining({
          params: expect.objectContaining({
            accountEmail: 'owner@example.com',
            oauthConnectionScope: 'personal',
            oauthConnectionId: 'google-personal'
          }),
          dirty: true
        })
      )
    })
  })

  it('clears workspace selections when the shared credential is removed', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [googlePersonalPayload],
        workspace: [googleWorkspacePayload]
      })
    )

    mockParamsRef.current = {
      ...createBaseParams(),
      accountEmail: 'ops@example.com',
      oauthConnectionScope: 'workspace',
      oauthConnectionId: 'google-workspace'
    }

    render(<SheetsAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(mockParamsRef.current.accountEmail).toBe('ops@example.com')
      expect(mockParamsRef.current.oauthConnectionScope).toBe('workspace')
      expect(mockParamsRef.current.oauthConnectionId).toBe('google-workspace')
    })

    updateNodeData.mockClear()

    await act(async () => {
      updateCachedConnections(() => buildConnectionMap(false))
    })

    await waitFor(() => {
      expect(mockParamsRef.current.accountEmail).toBe('')
      expect(mockParamsRef.current.oauthConnectionScope).toBe('')
      expect(mockParamsRef.current.oauthConnectionId).toBe('')
    })

    expect(updateNodeData).toHaveBeenCalledWith(
      nodeId,
      expect.objectContaining({
        params: expect.objectContaining({
          accountEmail: '',
          oauthConnectionScope: '',
          oauthConnectionId: ''
        }),
        dirty: true
      })
    )
  })

  it('drops revoked personal credentials from the selection', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [
          {
            ...googlePersonalPayload,
            requiresReconnect: true
          }
        ],
        workspace: []
      })
    )

    mockParamsRef.current = {
      ...createBaseParams(),
      accountEmail: 'owner@example.com',
      oauthConnectionScope: 'personal',
      oauthConnectionId: 'google-personal'
    }

    render(<SheetsAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(mockParamsRef.current.accountEmail).toBe('')
      expect(mockParamsRef.current.oauthConnectionScope).toBe('')
      expect(mockParamsRef.current.oauthConnectionId).toBe('')
      expect(updateNodeData).toHaveBeenCalledWith(
        nodeId,
        expect.objectContaining({
          params: expect.objectContaining({
            accountEmail: '',
            oauthConnectionScope: '',
            oauthConnectionId: ''
          }),
          dirty: true
        })
      )
    })
  })

  it('does not refetch when workspace connections are promoted elsewhere', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        success: true,
        personal: [googlePersonalPayload],
        workspace: []
      })
    )

    render(<SheetsAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(mockParamsRef.current.accountEmail).toBe('owner@example.com')
    })

    await act(async () => {
      updateCachedConnections(() => buildConnectionMap(true))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dispatches spreadsheet updates through focused patches', async () => {
    vi.useFakeTimers()
    vi.spyOn(global, 'fetch').mockResolvedValue(
      createJsonResponse({ success: true, personal: [], workspace: [] })
    )

    try {
      render(<SheetsAction nodeId={nodeId} />)

      await act(async () => {
        vi.runAllTimers()
      })

      updateNodeData.mockClear()

      const input = screen.getByPlaceholderText('Spreadsheet ID')
      fireEvent.change(input, { target: { value: 'new-sheet-id' } })

      await act(async () => {
        vi.runAllTimers()
      })

      expect(updateNodeData).toHaveBeenCalledWith(
        nodeId,
        expect.objectContaining({
          params: expect.objectContaining({ spreadsheetId: 'new-sheet-id' }),
          dirty: true
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends column mapping updates with focused patches', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      createJsonResponse({ success: true, personal: [], workspace: [] })
    )

    render(<SheetsAction nodeId={nodeId} />)

    const addButton = await screen.findByRole('button', {
      name: /add variable/i
    })

    updateNodeData.mockClear()

    fireEvent.click(addButton)

    expect(updateNodeData).toHaveBeenCalledWith(
      nodeId,
      expect.objectContaining({
        params: expect.objectContaining({
          columns: [
            { key: 'A', value: 'value' },
            { key: '', value: '' }
          ]
        }),
        dirty: true
      })
    )
  })

  it('toggles hasValidationErrors when inputs transition between invalid and valid', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      createJsonResponse({
        success: true,
        personal: [googlePersonalPayload],
        workspace: []
      })
    )

    act(() => {
      updateCachedConnections(() => buildConnectionMap(false))
    })

    mockParamsRef.current = {
      ...createBaseParams(),
      spreadsheetId: '',
      columns: []
    }

    const { rerender } = render(<SheetsAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(validationStateRef.current).toBe(true)
    })

    expect(updateNodeData).toHaveBeenCalledWith(
      nodeId,
      expect.objectContaining({ hasValidationErrors: true })
    )

    updateNodeData.mockClear()

    mockParamsRef.current = {
      ...createBaseParams(),
      spreadsheetId: 'sheet-id',
      columns: [{ key: 'A', value: 'value' }],
      accountEmail: 'owner@example.com',
      oauthConnectionScope: 'personal',
      oauthConnectionId: 'google-personal'
    }

    rerender(<SheetsAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(validationStateRef.current).toBe(false)
    })

    expect(updateNodeData).toHaveBeenCalledWith(
      nodeId,
      expect.objectContaining({ hasValidationErrors: false })
    )
  })
})

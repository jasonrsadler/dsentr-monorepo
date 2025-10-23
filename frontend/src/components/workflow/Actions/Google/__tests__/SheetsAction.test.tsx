import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import SheetsAction from '../SheetsAction'
import type { SheetsActionParams } from '@/stores/workflowSelectors'

const createBaseParams = (): SheetsActionParams => ({
  spreadsheetId: 'sheet-123',
  worksheet: 'Sheet1',
  columns: [{ key: 'A', value: 'name' }],
  accountEmail: 'user@example.com',
  oauthConnectionScope: 'personal',
  oauthConnectionId: 'conn-1',
  dirty: false
})

const paramsRef: { current: SheetsActionParams } = {
  current: createBaseParams()
}

const updateNodeData = vi.fn()
const workflowState = {
  canEdit: true,
  updateNodeData
}

vi.mock('@/components/UI/InputFields/NodeInputField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder }: any) => (
    <input
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('@/components/UI/ReactFlow/KeyValuePair', () => ({
  __esModule: true,
  default: ({ onChange, variables }: any) => (
    <button onClick={() => onChange(variables)}>MockKeyValuePair</button>
  )
}))

vi.mock('@/stores/workflowSelectors', () => ({
  useSheetsActionParams: () => paramsRef.current
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

vi.mock('@/stores/auth', () => {
  const mockAuthState = { workspace: { id: 'ws-1' } }

  return {
    useAuth: (selector?: any) =>
      typeof selector === 'function' ? selector(mockAuthState) : mockAuthState,
    selectCurrentWorkspace: (state: typeof mockAuthState) => state
  }
})

const fetchConnections = vi.fn().mockResolvedValue({})
const getCachedConnections = vi.fn().mockReturnValue(null)
const subscribeToConnectionUpdates = vi.fn().mockReturnValue(() => {})

vi.mock('@/lib/oauthApi', () => ({
  fetchConnections: (...args: any[]) => fetchConnections(...args),
  getCachedConnections: (...args: any[]) => getCachedConnections(...args),
  subscribeToConnectionUpdates: (...args: any[]) =>
    subscribeToConnectionUpdates(...args)
}))

describe('SheetsAction', () => {
  const nodeId = 'sheets-node'

  beforeEach(() => {
    paramsRef.current = createBaseParams()
    workflowState.canEdit = true
    updateNodeData.mockClear()
    fetchConnections.mockClear()
    fetchConnections.mockResolvedValue({})
  })

  it('merges sheet param updates with the existing payload', async () => {
    render(<SheetsAction nodeId={nodeId} />)

    await screen.findByPlaceholderText('Spreadsheet ID')
    updateNodeData.mockClear()

    const worksheetInput = await screen.findByPlaceholderText('Worksheet Name')
    fireEvent.change(worksheetInput, { target: { value: 'Data Sheet' } })

    await waitFor(() => {
      const patchCall = updateNodeData.mock.calls.find(
        ([, payload]) => payload.params
      )

      expect(patchCall?.[1]).toEqual({
        params: {
          spreadsheetId: 'sheet-123',
          worksheet: 'Data Sheet',
          columns: [{ key: 'A', value: 'name' }],
          accountEmail: 'user@example.com',
          oauthConnectionScope: 'personal',
          oauthConnectionId: 'conn-1'
        },
        dirty: true
      })
    })
  })
})

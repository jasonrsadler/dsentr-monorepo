import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import SheetsAction from '../../../../../../src/components/workflow/Actions/Google/SheetsAction'
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

vi.mock('@/components/ui/InputFields/NodeInputField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder }: any) => (
    <input
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('@/components/ui/ReactFlow/KeyValuePair', () => ({
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

// Mock the sheet listing API
const mockSheets = [
  { id: 'sheet-1', title: 'Sheet A' },
  { id: 'sheet-2', title: 'Sheet B' }
]
vi.mock('@/lib/googleSheetsApi', () => ({
  fetchSpreadsheetSheets: vi.fn(() => Promise.resolve(mockSheets))
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

    // The worksheet field is now a dropdown. Select the first option.
    const worksheetSelect = await screen.findByLabelText('Select worksheet')
    fireEvent.change(worksheetSelect, { target: { value: 'sheet-1' } })

    await waitFor(() => {
      const patchCall = updateNodeData.mock.calls.find(
        ([, payload]) => payload.params
      )

      expect(patchCall?.[1]).toEqual({
        params: {
          spreadsheetId: 'sheet-123',
          worksheet: 'Sheet A',
          worksheetId: 'sheet-1',
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

import { act, renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import useActionNodeController, {
  PLAN_RESTRICTION_MESSAGES,
  type ActionNodeData
} from '@/components/workflow/nodes/useActionNodeController'
import type { BaseActionNodeRunState } from '@/components/workflow/nodes/BaseActionNode'
import { useWorkflowStore } from '@/stores/workflowStore'

describe('useActionNodeController', () => {
  const createRunState = (): BaseActionNodeRunState => ({
    canInvoke: true,
    isInvoking: false,
    isRunning: false,
    isSucceeded: false,
    isFailed: false,
    run: vi.fn().mockResolvedValue(undefined)
  })

  const resetStore = () => {
    act(() => {
      useWorkflowStore.setState((state) => ({
        ...state,
        nodes: [],
        edges: [],
        isDirty: false,
        isSaving: false,
        canEdit: true
      }))
    })
  }

  const setNodeData = (data: ActionNodeData) => {
    act(() => {
      useWorkflowStore.setState((state) => ({
        ...state,
        nodes: [
          {
            id: 'node-1',
            type: 'action',
            position: { x: 0, y: 0 },
            data
          } as unknown as (typeof state.nodes)[number]
        ],
        edges: []
      }))
    })
  }

  const buildOptions = (overrides: Partial<ActionNodeData> = {}) => {
    const node = useWorkflowStore.getState().nodes[0]
    return {
      id: 'node-1',
      nodeData: {
        label: 'Action',
        expanded: false,
        dirty: false,
        actionType: 'email',
        ...((node?.data as ActionNodeData | undefined) ?? {}),
        ...overrides
      } as ActionNodeData,
      planTier: 'workspace' as string | null,
      effectiveCanEdit: true,
      onRestrictionNotice: undefined as ((message: string) => void) | undefined,
      toggleExpanded: vi.fn(),
      remove: vi.fn(),
      runState: createRunState()
    }
  }

  beforeEach(() => {
    resetStore()
  })

  it('emits plan restriction notices for restricted sheets actions', async () => {
    const noticeSpy = vi.fn()
    const runState = createRunState()

    setNodeData({
      label: 'Sheets',
      expanded: false,
      dirty: false,
      actionType: 'sheets'
    })

    const { result } = renderHook(() =>
      useActionNodeController({
        ...buildOptions(),
        planTier: 'solo',
        onRestrictionNotice: noticeSpy,
        runState
      })
    )

    expect(result.current.planRestrictionMessage).toBe(
      PLAN_RESTRICTION_MESSAGES.sheets
    )
    expect(result.current.canRunTest).toBe(false)

    await waitFor(() => {
      expect(noticeSpy).toHaveBeenCalledWith(PLAN_RESTRICTION_MESSAGES.sheets)
    })

    act(() => {
      result.current.handleTestAction()
    })

    expect(runState.run).not.toHaveBeenCalled()
  })

  it('merges child param updates and marks the node dirty', async () => {
    setNodeData({
      label: 'Email',
      expanded: false,
      dirty: false,
      actionType: 'email',
      params: { provider: 'Mailgun' }
    })

    const { result } = renderHook(() => useActionNodeController(buildOptions()))

    act(() => {
      result.current.updateParams({ region: 'eu' }, { markDirty: true })
    })

    await waitFor(() => {
      expect(result.current.dirty).toBe(true)
    })

    await waitFor(() => {
      const params =
        (useWorkflowStore.getState().nodes[0]?.data?.params as Record<
          string,
          unknown
        >) ?? {}
      expect(params).toMatchObject({
        provider: 'Mailgun',
        region: 'eu'
      })
    })
  })
})

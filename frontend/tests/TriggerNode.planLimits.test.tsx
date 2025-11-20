import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'
import TriggerNode from '@/components/workflow/TriggerNode'
import { ReactFlowProvider } from '@xyflow/react'
import { WorkflowFlyoutProvider } from '@/components/workflow/useWorkflowFlyout'
import { useWorkflowStore } from '@/stores/workflowStore'

const flyoutContext = {
  openFlyout: () => undefined,
  activeNodeId: null,
  isFlyoutRender: false
}

const initialWorkflowState = useWorkflowStore.getState()

function resetWorkflowStore() {
  useWorkflowStore.setState(initialWorkflowState, true)
}

function seedTriggerNode() {
  useWorkflowStore.setState((state) => ({
    ...state,
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          label: 'Manual trigger',
          inputs: [],
          triggerType: 'manual',
          expanded: true,
          dirty: false,
          hasValidationErrors: false
        }
      } as any
    ],
    edges: [],
    canEdit: true
  }))
}

describe('TriggerNode run availability', () => {
  beforeEach(() => {
    resetWorkflowStore()
    seedTriggerNode()
  })

  afterEach(() => {
    resetWorkflowStore()
  })

  it('disables the run button and shows a quota reason when workspace runs are exhausted', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined)

    render(
      <WorkflowFlyoutProvider value={flyoutContext}>
        <ReactFlowProvider>
          <TriggerNode
            id="trigger-1"
            selected={false}
            canEdit
            planTier="workspace"
            onRun={onRun}
            runAvailability={{
              disabled: true,
              reason:
                'Workspace run usage has reached the monthly allocation. Upgrade to continue.'
            }}
          />
        </ReactFlowProvider>
      </WorkflowFlyoutProvider>
    )

    const runButton = await screen.findByRole('button', { name: /run/i })
    expect(runButton).toBeDisabled()
    expect(runButton).toHaveAttribute(
      'title',
      'Workspace run usage has reached the monthly allocation. Upgrade to continue.'
    )

    const user = userEvent.setup()
    await user.click(runButton)
    expect(onRun).not.toHaveBeenCalled()
  })

  it('invokes the run handler when the workspace still has available runs', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined)

    render(
      <WorkflowFlyoutProvider value={flyoutContext}>
        <ReactFlowProvider>
          <TriggerNode
            id="trigger-1"
            selected={false}
            canEdit
            planTier="workspace"
            onRun={onRun}
            runAvailability={undefined}
          />
        </ReactFlowProvider>
      </WorkflowFlyoutProvider>
    )

    const runButton = await screen.findByRole('button', { name: /run/i })
    expect(runButton).not.toBeDisabled()

    const user = userEvent.setup()
    await user.click(runButton)

    expect(onRun).toHaveBeenCalledWith('trigger-1', [])
  })
})

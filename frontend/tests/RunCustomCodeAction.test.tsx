import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RunCustomCodeAction from '../src/components/workflow/Actions/RunCustomCodeAction'
import RunCustomCodeActionNode from '../src/components/workflow/nodes/RunCustomCodeActionNode'
import type { RunCustomCodeActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'
import { TestFlowWrapper } from './helpers/TestFlowWrapper'

const nodeId = 'run-custom'

const createBaseParams = (
  overrides: Partial<RunCustomCodeActionParams> = {}
): RunCustomCodeActionParams => ({
  code: '',
  inputs: [],
  outputs: [],
  dirty: false,
  ...overrides
})

const seedCustomCodeNode = (params: RunCustomCodeActionParams) => {
  useWorkflowStore.setState((state) => ({
    ...state,
    nodes: [
      {
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          label: 'Custom code',
          params,
          dirty: false,
          hasValidationErrors: false
        }
      } as any
    ],
    edges: [],
    isDirty: false,
    canEdit: true
  }))

  const updateNodeData = vi.fn((id: string, payload: unknown) => {
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
  return updateNodeData
}

const findParamsCall = (mock: ReturnType<typeof vi.fn>) =>
  [...mock.mock.calls]
    .reverse()
    .find((call) =>
      Boolean(
        call?.[0] === nodeId && call?.[1] && 'params' in (call?.[1] || {})
      )
    )

describe('RunCustomCodeAction', () => {
  beforeEach(() => {
    useWorkflowStore.setState((state) => ({
      ...state,
      nodes: [],
      edges: [],
      isDirty: false,
      canEdit: true
    }))
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

  it('updates the code field while preserving existing inputs and outputs', async () => {
    const initial = createBaseParams({
      code: 'return foo + bar',
      inputs: [
        { key: 'foo', value: '1' },
        { key: 'bar', value: '2' }
      ],
      outputs: [{ key: 'sum', value: '3' }]
    })
    const updateNodeData = seedCustomCodeNode(initial)

    render(<RunCustomCodeAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: false
      })
    })

    const textarea = screen.getByPlaceholderText('Enter custom JavaScript code')

    act(() => {
      fireEvent.change(textarea, {
        target: { value: 'return foo - bar' }
      })
    })

    await waitFor(() => {
      expect(
        updateNodeData.mock.calls.some(
          ([id, payload]) =>
            id === nodeId &&
            Boolean(
              payload &&
              'params' in payload &&
              (payload as { params: RunCustomCodeActionParams }).params
                .code === 'return foo - bar'
            )
        )
      ).toBe(true)
    })

    const paramsCall = findParamsCall(updateNodeData)
    expect(paramsCall?.[1]).toMatchObject({
      params: {
        code: 'return foo - bar',
        inputs: initial.inputs,
        outputs: initial.outputs
      },
      dirty: true
    })
  })

  it('retains the script when inputs are modified', async () => {
    const updateNodeData = seedCustomCodeNode(
      createBaseParams({ code: 'return id' })
    )

    render(<RunCustomCodeAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: false
      })
    })

    const [inputsAddButton] = screen.getAllByRole('button', {
      name: /Add variable/i
    })
    fireEvent.click(inputsAddButton)

    const inputsSection = screen.getByText('Inputs')
      .parentElement as HTMLElement
    const keyInput = within(inputsSection).getByPlaceholderText('key')

    act(() => {
      fireEvent.change(keyInput, { target: { value: 'id' } })
    })

    await waitFor(() => {
      expect(
        updateNodeData.mock.calls.some(
          ([id, payload]) =>
            id === nodeId &&
            Boolean(
              payload &&
              'params' in payload &&
              (payload as { params: RunCustomCodeActionParams }).params
                .inputs?.[0]?.key === 'id'
            )
        )
      ).toBe(true)
    })

    const paramsCall = findParamsCall(updateNodeData)
    expect(paramsCall?.[1]).toMatchObject({
      params: {
        code: 'return id',
        inputs: [{ key: 'id', value: '' }],
        outputs: []
      },
      dirty: true
    })
  })

  it('preserves the code when outputs are updated', async () => {
    const updateNodeData = seedCustomCodeNode(
      createBaseParams({ code: 'return result' })
    )

    render(<RunCustomCodeAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: false
      })
    })

    const addButtons = screen.getAllByRole('button', {
      name: /Add variable/i
    })
    const outputsAddButton = addButtons.at(1)
    expect(outputsAddButton).toBeTruthy()
    fireEvent.click(outputsAddButton!)

    const outputsSection = screen.getByText('Outputs')
      .parentElement as HTMLElement
    const valueInput = within(outputsSection).getByPlaceholderText('value')

    act(() => {
      fireEvent.change(valueInput, { target: { value: 'result' } })
    })

    await waitFor(() => {
      expect(
        updateNodeData.mock.calls.some(
          ([id, payload]) =>
            id === nodeId &&
            Boolean(
              payload &&
              'params' in payload &&
              (payload as { params: RunCustomCodeActionParams }).params
                .outputs?.[0]?.value === 'result'
            )
        )
      ).toBe(true)
    })

    const paramsCall = findParamsCall(updateNodeData)
    expect(paramsCall?.[1]).toMatchObject({
      params: {
        code: 'return result',
        inputs: [],
        outputs: [{ key: '', value: 'result' }]
      },
      dirty: true
    })
  })

  it('toggles validation flags when syntax errors are resolved', async () => {
    const updateNodeData = seedCustomCodeNode(
      createBaseParams({ code: 'function(' })
    )

    render(<RunCustomCodeAction nodeId={nodeId} />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: true
      })
    })

    const textarea = screen.getByPlaceholderText('Enter custom JavaScript code')

    act(() => {
      fireEvent.change(textarea, {
        target: { value: 'function test() { return 1 }' }
      })
    })

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith(nodeId, {
        hasValidationErrors: false
      })
    })
  })

  it('disables test actions when run availability is blocked', async () => {
    seedCustomCodeNode(createBaseParams())

    render(
      <TestFlowWrapper>
        <RunCustomCodeActionNode
          id={nodeId}
          selected={false}
          onRun={vi.fn()}
          runAvailability={{
            disabled: true,
            reason: 'Monthly run limit reached.'
          }}
        />
      </TestFlowWrapper>
    )


    const button = screen.getByRole('button', { name: /Test Action/i })
    expect(button).toBeDisabled()

    expect(screen.getByText(/monthly run limit reached/i))
      .toBeInTheDocument()
  })
})

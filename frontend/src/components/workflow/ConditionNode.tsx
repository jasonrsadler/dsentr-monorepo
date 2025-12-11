import { useState, useMemo, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'
import NodeHeader from '@/components/ui/ReactFlow/NodeHeader'
import BaseNode, { type BaseNodeRenderProps } from './BaseNode'
import { useWorkflowStore, type WorkflowState } from '@/stores/workflowStore'
import NodeFlyoutSurface from './NodeFlyoutSurface'

export type ConditionNodeData = {
  field?: string
  operator?: string
  value?: string
  expression?: string
  dirty?: boolean
  expanded?: boolean
  hasValidationErrors?: boolean
  label?: string
  labelError?: string | null
  hasLabelValidationError?: boolean
}

interface ConditionNodeProps {
  id: string
  selected: boolean
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  canEdit?: boolean
}

type ConditionNodeContentProps = BaseNodeRenderProps<ConditionNodeData> & {
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
}

export default function ConditionNode({
  id,
  selected,
  isRunning,
  isSucceeded,
  isFailed,
  canEdit = true
}: ConditionNodeProps) {
  const selectNodeData = useMemo(
    () => (state: WorkflowState) =>
      state.nodes.find((node) => node.id === id)?.data as
        | ConditionNodeData
        | undefined,
    [id]
  )
  const nodeData = useWorkflowStore(selectNodeData)

  return (
    <BaseNode<ConditionNodeData>
      id={id}
      selected={selected}
      canEdit={canEdit}
      fallbackLabel="Condition"
      defaultExpanded
      defaultDirty={!nodeData}
    >
      {(renderProps) => (
        <ConditionNodeContent
          {...renderProps}
          isRunning={isRunning}
          isSucceeded={isSucceeded}
          isFailed={isFailed}
        />
      )}
    </BaseNode>
  )
}

function ConditionNodeContent({
  id,
  selected,
  label,
  dirty,
  nodeData,
  updateData,
  remove,
  effectiveCanEdit,
  isRunning,
  isSucceeded,
  isFailed
}: ConditionNodeContentProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const field = typeof nodeData?.field === 'string' ? nodeData.field : ''
  const operator =
    typeof nodeData?.operator === 'string' ? nodeData.operator : 'equals'
  const value = typeof nodeData?.value === 'string' ? nodeData.value : ''
  const labelError = nodeData?.labelError ?? null

  const computeConditionState = useCallback(
    (nextField: string, nextOperator: string, nextValue: string) => {
      const normalizedField = nextField ?? ''
      const normalizedOperator = nextOperator ?? 'equals'
      const normalizedValue = nextValue ?? ''
      const expression = buildExpression(
        normalizedField,
        normalizedOperator,
        normalizedValue
      )
      const hasValidationErrors =
        !normalizedField.trim() ||
        !normalizedOperator ||
        !normalizedValue.trim()

      return { expression, hasValidationErrors }
    },
    []
  )

  const { expression, hasValidationErrors } = useMemo(
    () => computeConditionState(field, operator, value),
    [computeConditionState, field, operator, value]
  )

  useEffect(() => {
    if (!effectiveCanEdit) return
    const patch: Partial<ConditionNodeData> = {}
    if (nodeData?.expression !== expression) {
      patch.expression = expression
    }
    if ((nodeData?.hasValidationErrors ?? false) !== hasValidationErrors) {
      patch.hasValidationErrors = hasValidationErrors
    }
    if (Object.keys(patch).length === 0) return
    updateData(patch)
  }, [
    effectiveCanEdit,
    expression,
    hasValidationErrors,
    nodeData?.expression,
    nodeData?.hasValidationErrors,
    updateData
  ])

  const combinedHasValidationErrors = hasValidationErrors || Boolean(labelError)

  const handleLabelChange = useCallback(
    (nextLabel: string) => {
      if (!effectiveCanEdit) return
      updateData({ label: nextLabel, dirty: true })
    },
    [effectiveCanEdit, updateData]
  )

  const handleConfirmDelete = useCallback(() => {
    if (!effectiveCanEdit) return
    setConfirmingDelete(true)
  }, [effectiveCanEdit])

  const handleDelete = useCallback(() => {
    setConfirmingDelete(false)
    remove()
  }, [remove])

  const ringClass = isFailed
    ? 'ring-2 ring-red-500'
    : isSucceeded
      ? 'ring-2 ring-emerald-500'
      : isRunning
        ? 'ring-2 ring-sky-500'
        : ''

  return (
    <motion.div
      className={`wf-node group relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? 'ring-2 ring-blue-500' : 'border-zinc-300 dark:border-zinc-700'} ${ringClass}`}
      style={{
        width: 256,
        minWidth: 256
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 14,
          height: 14,
          backgroundColor: 'blue',
          border: '2px solid white'
        }}
      />
      <Handle
        id="cond-true"
        type="source"
        position={Position.Right}
        style={{
          top: 16,
          right: -7,
          width: 14,
          height: 14,
          backgroundColor: '#16a34a',
          border: '2px solid white',
          transform: 'none'
        }}
        title="True"
      />
      <Handle
        id="cond-false"
        type="source"
        position={Position.Right}
        style={{
          top: 'auto',
          bottom: 16,
          right: -7,
          width: 14,
          height: 14,
          backgroundColor: '#ef4444',
          border: '2px solid white',
          transform: 'none'
        }}
        title="False"
      />

      <div className="p-3">
        <NodeHeader
          nodeId={id}
          label={label}
          dirty={dirty}
          hasValidationErrors={combinedHasValidationErrors}
          expanded={false}
          showExpandToggle={false}
          onLabelChange={handleLabelChange}
          onExpanded={() => undefined}
          onConfirmingDelete={handleConfirmDelete}
        />
        {labelError && (
          <p className="mt-2 text-xs text-red-500">{labelError}</p>
        )}

        <div className="mt-3 space-y-2 text-xs text-zinc-600 dark:text-zinc-300">
          <p className="font-semibold text-zinc-700 dark:text-zinc-200">
            Condition expression
          </p>
          <NodeFlyoutSurface
            nodeId={id}
            hoverLabel="Click to edit this condition"
            className="text-zinc-700 dark:text-zinc-200"
          >
            {expression ? (
              <p className="break-words text-zinc-700 dark:text-zinc-200">
                {expression}
              </p>
            ) : (
              <p className="text-zinc-500 dark:text-zinc-400">
                Configure this condition in the flyout.
              </p>
            )}
          </NodeFlyoutSurface>
          {hasValidationErrors ? (
            <p className="text-red-500">
              Field and value are required for this condition.
            </p>
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {confirmingDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl"
          >
            <div className="bg-white dark:bg-zinc-800 p-4 rounded-xl shadow-md w-56">
              <p className="text-sm mb-3">Delete this node?</p>
              <p className="text-sm mb-3">This action can not be undone</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-2 py-1 text-xs rounded border"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function buildExpression(field: string, operator: string, value: string) {
  const left = field.trim()
  if (!left) {
    return ''
  }

  const operatorSymbol = OPERATOR_SYMBOLS[operator.toLowerCase()] ?? '=='
  const formattedLeft = left.startsWith('{{') ? left : `{{${left}}}`
  const formattedRight = formatExpressionValue(value)

  return `${formattedLeft} ${operatorSymbol} ${formattedRight}`.trim()
}

const OPERATOR_SYMBOLS: Record<string, string> = {
  equals: '==',
  'not equals': '!=',
  'greater than': '>',
  'less than': '<',
  contains: 'contains'
}

function formatExpressionValue(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return '""'
  }

  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    return trimmed
  }

  if (/^(true|false|null)$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (!Number.isNaN(Number(trimmed))) {
    return trimmed
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return JSON.stringify(trimmed.slice(1, -1))
  }

  return JSON.stringify(trimmed)
}

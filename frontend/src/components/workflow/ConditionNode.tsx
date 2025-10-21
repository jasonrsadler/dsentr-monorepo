import { memo, useCallback, useMemo, useRef, useState } from 'react'
import deepEqual from 'fast-deep-equal'
import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'
import NodeInputField from '@/components/ui/input-fields/NodeInputField'
import NodeDropdownField from '@/components/ui/input-fields/NodeDropdownField'
import NodeHeader from '@/components/ui/react-flow/NodeHeader'

interface ConditionNodeProps {
  id: string
  data: {
    id?: string
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
  selected: boolean
  onRemove?: (id: string) => void
  onChange?: (id: string, data: any, suppressDirty?: boolean) => void
  markDirty?: () => void
  onRun?: (id: string) => void
}

type ConditionNodeStoreData = {
  id?: string
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
  nodeStatus?: {
    isRunning?: boolean
    isSucceeded?: boolean
    isFailed?: boolean
    running?: boolean
    succeeded?: boolean
    failed?: boolean
  }
  status?: {
    isRunning?: boolean
    isSucceeded?: boolean
    isFailed?: boolean
    running?: boolean
    succeeded?: boolean
    failed?: boolean
  }
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
}

type ConditionNodeUpdatePayload = {
  label: string
  field: string
  operator: string
  value: string
  expression: string
  dirty: boolean
  expanded: boolean
  hasValidationErrors: boolean
  labelError: string | null
  hasLabelValidationError: boolean
}

type ConditionEvaluation = {
  expression: string
  fieldError: boolean
  operatorError: boolean
  valueError: boolean
  hasValidationErrors: boolean
}

type NodeStatusSnapshot = {
  isRunning: boolean
  isSucceeded: boolean
  isFailed: boolean
}

function deriveNodeStatus(data?: ConditionNodeStoreData): NodeStatusSnapshot {
  if (!data) {
    return { isRunning: false, isSucceeded: false, isFailed: false }
  }

  const nested =
    (typeof data.nodeStatus === 'object' && data.nodeStatus) ||
    (typeof data.status === 'object' && data.status) ||
    {}
  const nestedRecord = nested as Record<string, unknown>

  const resolve = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value
    return Boolean(value)
  }

  const isRunning = resolve(
    data.isRunning ?? nestedRecord.isRunning ?? nestedRecord.running
  )
  const isSucceeded = resolve(
    data.isSucceeded ?? nestedRecord.isSucceeded ?? nestedRecord.succeeded
  )
  const isFailed = resolve(
    data.isFailed ?? nestedRecord.isFailed ?? nestedRecord.failed
  )

  return { isRunning, isSucceeded, isFailed }
}

function evaluateConditionInputs(
  field: string,
  operator: string,
  value: string
): ConditionEvaluation {
  const trimmedField = field.trim()
  const trimmedOperator = operator.trim()
  const trimmedValue = value.trim()
  const expression = buildExpression(
    trimmedField,
    trimmedOperator,
    trimmedValue
  )
  const fieldError = trimmedField.length === 0
  const operatorError = trimmedOperator.length === 0
  const valueError = trimmedValue.length === 0
  return {
    expression,
    fieldError,
    operatorError,
    valueError,
    hasValidationErrors: fieldError || operatorError || valueError
  }
}

function ConditionNode({
  id,
  data,
  selected,
  onRemove,
  onChange,
  markDirty
}: ConditionNodeProps) {
  const nodeData = useMemo(() => (data ?? {}) as ConditionNodeStoreData, [data])

  const derivedState = useMemo(() => {
    const storedId = nodeData?.id
    const label = nodeData?.label ?? 'Condition'
    const field = nodeData?.field ?? ''
    const operator = nodeData?.operator ?? 'equals'
    const value = nodeData?.value ?? ''
    const expanded = nodeData?.expanded ?? true
    const isNewNode = !storedId
    const dirty =
      typeof nodeData?.dirty === 'boolean' ? nodeData.dirty : isNewNode
    const rawLabelError = nodeData?.labelError ?? null
    const hasLabelValidationError =
      nodeData?.hasLabelValidationError ?? Boolean(rawLabelError)

    return {
      label,
      field,
      operator,
      value,
      expanded,
      dirty,
      rawLabelError,
      hasLabelValidationError
    }
  }, [nodeData])

  const {
    label,
    field,
    operator,
    value,
    expanded,
    dirty,
    rawLabelError,
    hasLabelValidationError
  } = derivedState
  const { isRunning, isSucceeded, isFailed } = useMemo(
    () => deriveNodeStatus(nodeData),
    [nodeData]
  )

  const evaluation = useMemo(
    () => evaluateConditionInputs(field, operator, value),
    [field, operator, value]
  )

  const combinedHasValidationErrors = useMemo(
    () => evaluation.hasValidationErrors || Boolean(rawLabelError),
    [evaluation.hasValidationErrors, rawLabelError]
  )
  const showFieldError = evaluation.hasValidationErrors && evaluation.fieldError
  const showValueError = evaluation.hasValidationErrors && evaluation.valueError

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const lastEmissionRef = useRef<{
    id: string
    payload: ConditionNodeUpdatePayload
  } | null>(null)
  const handleChange = useCallback(
    (
      partial: Partial<ConditionNodeUpdatePayload>,
      options?: { suppressDirty?: boolean }
    ) => {
      const nextField = partial.field ?? field
      const nextOperator = partial.operator ?? operator
      const nextValue = partial.value ?? value
      const nextLabel = 'label' in partial ? (partial.label ?? '') : label
      const nextExpanded =
        'expanded' in partial ? Boolean(partial.expanded) : expanded
      const nextDirty = 'dirty' in partial ? Boolean(partial.dirty) : dirty
      const nextLabelError =
        'labelError' in partial ? (partial.labelError ?? null) : rawLabelError
      const nextHasLabelValidationError =
        'hasLabelValidationError' in partial
          ? Boolean(partial.hasLabelValidationError)
          : hasLabelValidationError || Boolean(nextLabelError)

      const evaluated = evaluateConditionInputs(
        nextField,
        nextOperator,
        nextValue
      )

      const nextHasValidationErrors =
        'hasValidationErrors' in partial &&
        partial.hasValidationErrors !== undefined
          ? Boolean(partial.hasValidationErrors)
          : evaluated.hasValidationErrors

      const payload: ConditionNodeUpdatePayload = {
        label: nextLabel,
        field: nextField,
        operator: nextOperator,
        value: nextValue,
        expression: evaluated.expression,
        dirty: nextDirty,
        expanded: nextExpanded,
        hasValidationErrors: nextHasValidationErrors,
        labelError: nextLabelError,
        hasLabelValidationError: nextHasLabelValidationError
      }

      const previous = lastEmissionRef.current
      if (
        previous &&
        previous.id === id &&
        deepEqual(previous.payload, payload)
      ) {
        return
      }

      lastEmissionRef.current = { id, payload }

      onChange?.(id, payload, options?.suppressDirty ?? false)

      if (!options?.suppressDirty && payload.dirty !== dirty) {
        markDirty?.()
      }
    },
    [
      dirty,
      expanded,
      field,
      hasLabelValidationError,
      id,
      label,
      markDirty,
      onChange,
      operator,
      rawLabelError,
      value
    ]
  )

  const ringClass = isFailed
    ? 'ring-2 ring-red-500'
    : isSucceeded
      ? 'ring-2 ring-emerald-500'
      : isRunning
        ? 'ring-2 ring-sky-500'
        : ''

  return (
    <motion.div
      className={`wf-node relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? 'ring-2 ring-blue-500' : 'border-zinc-300 dark:border-zinc-700'} ${ringClass}`}
      style={{ width: expanded ? 'auto' : 256, minWidth: 256, maxWidth: 400 }}
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
      {/* True output (top-right) */}
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
      {/* False output (bottom-right) */}
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
          label={label}
          dirty={dirty}
          hasValidationErrors={combinedHasValidationErrors}
          expanded={expanded}
          onLabelChange={(val) => handleChange({ label: val, dirty: true })}
          onExpanded={() =>
            handleChange({ expanded: !expanded }, { suppressDirty: true })
          }
          onConfirmingDelete={() => setConfirmingDelete(true)}
        />
        {rawLabelError && (
          <p className="mt-2 text-xs text-red-500">{rawLabelError}</p>
        )}

        <AnimatePresence>
          {expanded && (
            <motion.div
              key="expanded-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2"
            >
              <NodeInputField
                placeholder="Field name"
                value={field}
                onChange={(val) => handleChange({ field: val, dirty: true })}
              />
              {showFieldError && (
                <p className="text-red-500 text-xs mt-1">Field is required</p>
              )}
              <NodeDropdownField
                options={[
                  'equals',
                  'not equals',
                  'greater than',
                  'less than',
                  'contains'
                ]}
                value={operator}
                onChange={(val) => handleChange({ operator: val, dirty: true })}
              />

              <NodeInputField
                placeholder="Comparison value"
                value={value}
                onChange={(val) => handleChange({ value: val, dirty: true })}
              />
              {showValueError && (
                <p className="text-red-500 text-xs mt-1">Value is required</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
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
                  onClick={() => {
                    setConfirmingDelete(false)
                    onRemove?.(id)
                  }}
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

export default memo(ConditionNode)

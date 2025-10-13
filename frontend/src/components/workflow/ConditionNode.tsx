import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import NodeHeader from '@/components/UI/ReactFlow/NodeHeader'

interface ConditionNodeProps {
  id: string
  data: {
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
  onUpdateNode?: (id: string, data: any, suppressDirty?: boolean) => void
  onDirtyChange?: (dirty: boolean, data: any) => void
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
}

export default function ConditionNode({
  id,
  data,
  selected,
  onRemove,
  onUpdateNode,
  onDirtyChange,
  isRunning,
  isSucceeded,
  isFailed
}: ConditionNodeProps) {
  const isNewNode = !data?.id

  const [expanded, setExpanded] = useState(data?.expanded ?? true)
  const [dirty, setDirty] = useState(data?.dirty ?? isNewNode)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [hasValidationErrors, setHasValidationErrors] = useState(false)
  const [labelError, setLabelError] = useState<string | null>(
    data?.labelError ?? null
  )
  const combinedHasValidationErrors = hasValidationErrors || Boolean(labelError)

  const [field, setField] = useState(data?.field || '')
  const [operator, setOperator] = useState(data?.operator || 'equals')
  const [value, setValue] = useState(data?.value || '')
  const [label, setLabel] = useState(data?.label || 'Condition')

  useEffect(() => {
    setLabelError(data?.labelError ?? null)
  }, [data?.labelError])

  // Sync validation
  useEffect(() => {
    setHasValidationErrors(!field || !operator || !value)
  }, [field, operator, value])

  // Sync node data to parent
  useEffect(() => {
    const expression = buildExpression(field, operator, value)
    const nextData = {
      label,
      field,
      operator,
      value,
      expression,
      dirty,
      expanded,
      hasValidationErrors: combinedHasValidationErrors
    }
    onUpdateNode?.(id, nextData, true)
    if (dirty) onDirtyChange?.(true, nextData)
  }, [
    label,
    field,
    operator,
    value,
    dirty,
    expanded,
    hasValidationErrors,
    combinedHasValidationErrors,
    id,
    onUpdateNode,
    onDirtyChange
  ])

  // Sync dirty from parent
  useEffect(() => {
    if (data?.dirty !== undefined && data.dirty !== dirty) {
      setDirty(data.dirty)
    }
  }, [data?.dirty])

  // Reset local state when node id changes (e.g., new node or remount on workflow switch)
  useEffect(() => {
    setLabel(data?.label || 'Condition')
    setExpanded(data?.expanded ?? true)
    setField(data?.field || '')
    setOperator(data?.operator || 'equals')
    setValue(data?.value || '')
    setDirty(data?.dirty ?? isNewNode)
    setLabelError(data?.labelError ?? null)
  }, [id])

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
          onLabelChange={(val) => {
            setLabel(val)
            setDirty(true)
          }}
          onExpanded={() => setExpanded((prev) => !prev)}
          onConfirmingDelete={() => setConfirmingDelete(true)}
        />
        {labelError && (
          <p className="mt-2 text-xs text-red-500">{labelError}</p>
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
                onChange={(val) => {
                  setField(val)
                  setDirty(true)
                }}
              />
              {hasValidationErrors && !field && (
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
                onChange={(val) => {
                  setOperator(val)
                  setDirty(true)
                }}
              />

              <NodeInputField
                placeholder="Comparison value"
                value={value}
                onChange={(val) => {
                  setValue(val)
                  setDirty(true)
                }}
              />
              {hasValidationErrors && !value && (
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  normalizeFormatterConfig,
  OPERATION_GROUPS,
  validateFormatterConfig,
  type FormatterConfig
} from '@/components/actions/logic/FormatterNode/helpers'
import NodeHeader from '@/components/ui/ReactFlow/NodeHeader'
import BaseNode, { type BaseNodeRenderProps } from '../BaseNode'
import ActionNodeSummary from './ActionNodeSummary'
import type { RunAvailability } from '@/types/runAvailability'

export type FormatterNodeData = {
  label?: string
  expanded?: boolean
  dirty?: boolean
  config?: FormatterConfig
  hasValidationErrors?: boolean
  labelError?: string | null
  hasLabelValidationError?: boolean
}

interface FormatterNodeProps {
  id: string
  selected: boolean
  canEdit?: boolean
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  runAvailability?: RunAvailability
}

type FormatterNodeRenderProps = BaseNodeRenderProps<FormatterNodeData> & {
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
}

export default function FormatterNode({
  id,
  selected,
  canEdit = true,
  isRunning,
  isSucceeded,
  isFailed
}: FormatterNodeProps) {
  return (
    <BaseNode<FormatterNodeData>
      id={id}
      selected={selected}
      canEdit={canEdit}
      fallbackLabel="Formatter"
      defaultExpanded={false}
      defaultDirty
    >
      {(baseProps) => (
        <FormatterNodeContent
          id={id}
          baseProps={{
            ...baseProps,
            isRunning,
            isSucceeded,
            isFailed
          }}
        />
      )}
    </BaseNode>
  )
}

function FormatterNodeContent({
  id,
  baseProps
}: {
  id: string
  baseProps: FormatterNodeRenderProps
}) {
  const {
    selected,
    label,
    nodeData,
    updateData,
    remove,
    effectiveCanEdit,
    isRunning,
    isSucceeded,
    isFailed
  } = baseProps
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const normalizedConfig = useMemo(
    () =>
      normalizeFormatterConfig(nodeData?.config as FormatterConfig | undefined),
    [nodeData?.config]
  )
  const validation = useMemo(
    () => validateFormatterConfig(normalizedConfig),
    [normalizedConfig]
  )
  const operationLabel = useMemo(() => {
    const operation = normalizedConfig.operation?.trim()
    if (!operation) return ''
    const options = OPERATION_GROUPS.flatMap((group) => group.options)
    return options.find((option) => option.value === operation)?.label ?? ''
  }, [normalizedConfig.operation])
  const summaryItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = []
    if (operationLabel) {
      items.push({ label: 'Operation', value: operationLabel })
    }
    if (normalizedConfig.input?.trim()) {
      items.push({ label: 'Input', value: normalizedConfig.input.trim() })
    }
    if (normalizedConfig.output_key?.trim()) {
      items.push({
        label: 'Output',
        value: normalizedConfig.output_key.trim()
      })
    }
    return items
  }, [normalizedConfig.input, normalizedConfig.output_key, operationLabel])

  useEffect(() => {
    const hasValidationErrors = validation.hasErrors
    if ((nodeData?.hasValidationErrors ?? false) !== hasValidationErrors) {
      updateData({ hasValidationErrors })
    }
  }, [nodeData?.hasValidationErrors, updateData, validation.hasErrors])

  const handleLabelChange = useCallback(
    (next: string) => {
      if (!effectiveCanEdit) return
      updateData({ label: next, dirty: true })
    },
    [effectiveCanEdit, updateData]
  )

  const requestDelete = useCallback(() => {
    if (!effectiveCanEdit) return
    setConfirmingDelete(true)
  }, [effectiveCanEdit])

  const cancelDelete = useCallback(() => {
    setConfirmingDelete(false)
  }, [])

  const confirmDelete = useCallback(() => {
    if (!effectiveCanEdit) return
    setConfirmingDelete(false)
    remove()
  }, [effectiveCanEdit, remove])

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
      key="expanded-content"
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
        type="source"
        position={Position.Right}
        style={{
          width: 14,
          height: 14,
          backgroundColor: 'green',
          border: '2px solid white'
        }}
      />

      <div className="p-4">
        <NodeHeader
          nodeId={id}
          label={label}
          dirty={Boolean(nodeData?.dirty)}
          hasValidationErrors={
            Boolean(nodeData?.labelError) ||
            Boolean(nodeData?.hasValidationErrors)
          }
          expanded={false}
          showExpandToggle={false}
          onExpanded={() => undefined}
          onLabelChange={handleLabelChange}
          onConfirmingDelete={(e) => {
            e.preventDefault()
            e.stopPropagation()
            requestDelete()
          }}
        />

        {nodeData?.labelError ? (
          <p className="text-xs text-red-500">{nodeData.labelError}</p>
        ) : null}

        <div className="mt-3 px-1">
          <ActionNodeSummary
            nodeId={id}
            summaryItems={summaryItems}
            hint="Open the Formatter flyout to edit operations and mappings."
          />
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
                  type="button"
                  onClick={cancelDelete}
                  className="px-2 py-1 text-xs rounded border"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="px-2 py-1 text-xs rounded bg-red-500 text-white"
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

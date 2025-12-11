import { useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  normalizeDelayConfig,
  validateDelayConfig,
  type DelayConfig
} from '@/components/actions/logic/DelayNode/helpers'
import NodeHeader from '@/components/ui/ReactFlow/NodeHeader'
import BaseNode, { type BaseNodeRenderProps } from '../BaseNode'
import ActionNodeSummary from './ActionNodeSummary'
import type { RunAvailability } from '@/types/runAvailability'

export type DelayNodeData = {
  label?: string
  expanded?: boolean
  dirty?: boolean
  config?: DelayConfig
  hasValidationErrors?: boolean
  labelError?: string | null
  hasLabelValidationError?: boolean
}

interface DelayNodeProps {
  id: string
  selected: boolean
  canEdit?: boolean
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  runAvailability?: RunAvailability
}

type DelayNodeRenderProps = BaseNodeRenderProps<DelayNodeData> & {
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
}

export default function DelayNode({
  id,
  selected,
  canEdit = true,
  isRunning,
  isSucceeded,
  isFailed
}: DelayNodeProps) {
  return (
    <BaseNode<DelayNodeData>
      id={id}
      selected={selected}
      canEdit={canEdit}
      fallbackLabel="Delay"
      defaultExpanded={false}
      defaultDirty
    >
      {(baseProps) => (
        <DelayNodeContent
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

function DelayNodeContent({
  id,
  baseProps
}: {
  id: string
  baseProps: DelayNodeRenderProps
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
    () => normalizeDelayConfig(nodeData?.config as DelayConfig | undefined),
    [nodeData?.config]
  )
  const hasValidationErrors = useMemo(
    () => validateDelayConfig(normalizedConfig),
    [normalizedConfig]
  )

  useEffect(() => {
    if ((nodeData?.hasValidationErrors ?? false) !== hasValidationErrors) {
      updateData({ hasValidationErrors })
    }
  }, [hasValidationErrors, nodeData?.hasValidationErrors, updateData])

  const handleLabelChange = useCallback(
    (next: string) => {
      if (!effectiveCanEdit) return
      updateData({ label: next, dirty: true })
    },
    [effectiveCanEdit, updateData]
  )

  const handleConfigChange = useCallback(
    (nextConfig: DelayConfig) => {
      if (!effectiveCanEdit) return
      const normalizedNext = normalizeDelayConfig(nextConfig)
      const nextHasErrors = validateDelayConfig(normalizedNext)
      const currentHasErrors = nodeData?.hasValidationErrors ?? false
      const currentConfig = normalizeDelayConfig(
        nodeData?.config as DelayConfig | undefined
      )

      const configsEqual =
        JSON.stringify(currentConfig) === JSON.stringify(normalizedNext)

      if (configsEqual && currentHasErrors === nextHasErrors) {
        return
      }

      updateData({
        config: normalizedNext,
        hasValidationErrors: nextHasErrors,
        dirty: true
      })
    },
    [
      effectiveCanEdit,
      nodeData?.config,
      nodeData?.hasValidationErrors,
      updateData
    ]
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
      key="expanded-content"
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
        <ActionNodeSummary
          nodeId={id}
          hint="Open the Delay flyout to configure wait duration/date and jitter."
        />
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

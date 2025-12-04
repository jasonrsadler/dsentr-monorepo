import { useCallback, useEffect, useMemo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import FormatterNodeConfig from '@/components/actions/logic/FormatterNode'
import {
  normalizeFormatterConfig,
  validateFormatterConfig,
  type FormatterConfig
} from '@/components/actions/logic/FormatterNode/helpers'
import NodeHeader from '@/components/ui/ReactFlow/NodeHeader'
import BaseNode, { type BaseNodeRenderProps } from '../BaseNode'
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
      defaultExpanded
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
    expanded,
    nodeData,
    updateData,
    toggleExpanded,
    remove,
    effectiveCanEdit,
    isRunning,
    isSucceeded,
    isFailed
  } = baseProps

  const normalizedConfig = useMemo(
    () =>
      normalizeFormatterConfig(nodeData?.config as FormatterConfig | undefined),
    [nodeData?.config]
  )
  const validation = useMemo(
    () => validateFormatterConfig(normalizedConfig),
    [normalizedConfig]
  )

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

  const handleConfigChange = useCallback(
    (nextConfig: FormatterConfig) => {
      if (!effectiveCanEdit) return
      const normalizedNext = normalizeFormatterConfig(nextConfig)
      const nextValidation = validateFormatterConfig(normalizedNext)
      const currentConfig = normalizeFormatterConfig(
        nodeData?.config as FormatterConfig | undefined
      )

      const configsEqual =
        JSON.stringify(currentConfig) === JSON.stringify(normalizedNext)
      const validationEqual =
        (nodeData?.hasValidationErrors ?? false) === nextValidation.hasErrors

      if (configsEqual && validationEqual) {
        return
      }

      updateData({
        config: normalizedNext,
        hasValidationErrors: nextValidation.hasErrors,
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

  const handleDelete = useCallback(() => {
    if (!effectiveCanEdit) return
    const ok = window.confirm('Delete this node? This action cannot be undone.')
    if (ok) {
      remove()
    }
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
        width: expanded ? 'auto' : 256,
        minWidth: 256,
        maxWidth: 420
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
          expanded={expanded}
          onExpanded={toggleExpanded}
          onLabelChange={handleLabelChange}
          onConfirmingDelete={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleDelete()
          }}
        />

        {nodeData?.labelError ? (
          <p className="text-xs text-red-500">{nodeData.labelError}</p>
        ) : null}

        <AnimatePresence>
          {nodeData?.expanded && (
            <motion.div
              key="expanded-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2"
            >
              <FormatterNodeConfig
                config={normalizedConfig}
                onChange={handleConfigChange}
                validation={validation}
                canEdit={effectiveCanEdit}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

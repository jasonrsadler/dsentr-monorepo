import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'

import NodeHeader from '../../ui/ReactFlow/NodeHeader'
import BaseActionNode, {
  type BaseActionNodeChildrenProps
} from './BaseActionNode'
import useActionNodeController, {
  type ActionNodeData
} from './useActionNodeController'
import ActionNodeSummary from './ActionNodeSummary'
import type { RunAvailability } from '@/types/runAvailability'

interface AsanaActionNodeProps {
  id: string
  selected: boolean
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
  onRun?: (id: string, params: unknown) => Promise<void>
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  canEdit?: boolean
  runAvailability?: RunAvailability
}

type AsanaActionNodeRenderProps = BaseActionNodeChildrenProps<ActionNodeData>

type AsanaActionNodeContentProps = {
  id: string
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
  baseProps: AsanaActionNodeRenderProps
}

export default function AsanaActionNode({
  id,
  selected,
  planTier,
  onRestrictionNotice,
  onRun,
  isRunning,
  isSucceeded,
  isFailed,
  canEdit = true,
  runAvailability
}: AsanaActionNodeProps) {
  return (
    <BaseActionNode<ActionNodeData>
      id={id}
      selected={selected}
      canEdit={canEdit}
      fallbackLabel="Asana action"
      defaultExpanded
      onRun={onRun}
      isRunning={isRunning}
      isSucceeded={isSucceeded}
      isFailed={isFailed}
      runAvailability={runAvailability}
    >
      {(baseProps) => (
        <AsanaActionNodeContent
          id={id}
          planTier={planTier}
          onRestrictionNotice={onRestrictionNotice}
          baseProps={baseProps}
        />
      )}
    </BaseActionNode>
  )
}

function AsanaActionNodeContent({
  id,
  planTier,
  onRestrictionNotice,
  baseProps
}: AsanaActionNodeContentProps) {
  const {
    selected,
    runState,
    nodeData,
    toggleExpanded,
    remove,
    effectiveCanEdit
  } = baseProps

  const controller = useActionNodeController({
    id,
    nodeData: nodeData as ActionNodeData | null,
    planTier,
    effectiveCanEdit,
    onRestrictionNotice,
    toggleExpanded,
    remove
  })

  const ringClass = runState.isFailed
    ? 'ring-2 ring-red-500'
    : runState.isSucceeded
      ? 'ring-2 ring-emerald-500'
      : runState.isRunning
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
        type="source"
        position={Position.Right}
        style={{
          width: 14,
          height: 14,
          backgroundColor: 'green',
          border: '2px solid white'
        }}
      />
      <div className="p-3">
        <NodeHeader
          nodeId={id}
          label={controller.label}
          dirty={controller.dirty}
          hasValidationErrors={controller.combinedHasValidationErrors}
          expanded={false}
          showExpandToggle={false}
          onLabelChange={controller.handleLabelChange}
          onExpanded={controller.handleToggleExpanded}
          onConfirmingDelete={controller.requestDelete}
        />
        {controller.labelError && (
          <p className="mt-2 text-xs text-red-500">{controller.labelError}</p>
        )}
        <ActionNodeSummary
          nodeId={id}
          planRestrictionMessage={controller.planRestrictionMessage}
          onPlanUpgrade={controller.handlePlanUpgradeClick}
          hint="Open the Asana flyout to select a connection, operation, and fields."
        />
      </div>
      <AnimatePresence>
        {controller.confirmingDelete && (
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
                  onClick={controller.cancelDelete}
                  className="px-2 py-1 text-xs rounded border"
                >
                  Cancel
                </button>
                <button
                  onClick={controller.confirmDelete}
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

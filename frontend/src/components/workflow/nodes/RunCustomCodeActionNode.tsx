import { AnimatePresence, motion } from 'framer-motion'
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

interface RunCustomCodeActionNodeProps {
  id: string
  selected: boolean
  onRun?: (id: string, params: unknown) => Promise<void>
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  canEdit?: boolean
  runAvailability?: RunAvailability
}

type RunCustomCodeActionNodeRenderProps =
  BaseActionNodeChildrenProps<ActionNodeData>

type RunCustomCodeActionNodeContentProps = {
  id: string
  baseProps: RunCustomCodeActionNodeRenderProps
}

export default function RunCustomCodeActionNode({
  id,
  selected,
  onRun,
  isRunning,
  isSucceeded,
  isFailed,
  canEdit = true,
  runAvailability
}: RunCustomCodeActionNodeProps) {
  return (
    <BaseActionNode<ActionNodeData>
      id={id}
      selected={selected}
      canEdit={canEdit}
      fallbackLabel="Run custom code"
      defaultExpanded
      onRun={onRun}
      isRunning={isRunning}
      isSucceeded={isSucceeded}
      isFailed={isFailed}
      runAvailability={runAvailability}
    >
      {(baseProps) => (
        <RunCustomCodeActionNodeContent id={id} baseProps={baseProps} />
      )}
    </BaseActionNode>
  )
}

function RunCustomCodeActionNodeContent({
  id,
  baseProps
}: RunCustomCodeActionNodeContentProps) {
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
    effectiveCanEdit,
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
          hint="Open the custom code flyout to edit inputs, outputs, and script content."
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

import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'

import SlackAction from '../Actions/Messaging/Services/SlackAction'
import NodeHeader from '../../UI/ReactFlow/NodeHeader'
import NodeInputField from '../../UI/InputFields/NodeInputField'
import NodeCheckBoxField from '../../UI/InputFields/NodeCheckboxField'
import BaseActionNode, {
  type BaseActionNodeChildrenProps
} from './BaseActionNode'
import useActionNodeController, {
  type ActionNodeData
} from './useActionNodeController'
import useMessagingActionRestriction from './useMessagingActionRestriction'

interface SlackActionNodeProps {
  id: string
  selected: boolean
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
  onRun?: (id: string, params: unknown) => Promise<void>
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  canEdit?: boolean
}

type SlackActionNodeRenderProps = BaseActionNodeChildrenProps<ActionNodeData>

type SlackActionNodeContentProps = {
  id: string
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
  baseProps: SlackActionNodeRenderProps
}

export default function SlackActionNode({
  id,
  selected,
  planTier,
  onRestrictionNotice,
  onRun,
  isRunning,
  isSucceeded,
  isFailed,
  canEdit = true
}: SlackActionNodeProps) {
  return (
    <BaseActionNode<ActionNodeData>
      id={id}
      selected={selected}
      canEdit={canEdit}
      fallbackLabel="Slack message"
      defaultExpanded
      onRun={onRun}
      isRunning={isRunning}
      isSucceeded={isSucceeded}
      isFailed={isFailed}
    >
      {(baseProps) => (
        <SlackActionNodeContent
          id={id}
          planTier={planTier}
          onRestrictionNotice={onRestrictionNotice}
          baseProps={baseProps}
        />
      )}
    </BaseActionNode>
  )
}

function SlackActionNodeContent({
  id,
  planTier,
  onRestrictionNotice,
  baseProps
}: SlackActionNodeContentProps) {
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
    remove,
    runState
  })

  const { planRestrictionMessage: messagingRestrictionMessage, isRestricted } =
    useMessagingActionRestriction({
      provider: 'slack',
      isSoloPlan: controller.isSoloPlan,
      onRestrictionNotice
    })

  const planRestrictionMessage =
    messagingRestrictionMessage ?? controller.planRestrictionMessage

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
        width: controller.expanded ? 'auto' : 256,
        minWidth: controller.expanded ? 256 : undefined,
        maxWidth: controller.expanded ? 400 : undefined
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
          expanded={controller.expanded}
          onLabelChange={controller.handleLabelChange}
          onExpanded={controller.handleToggleExpanded}
          onConfirmingDelete={controller.requestDelete}
        />
        {controller.labelError && (
          <p className="mt-2 text-xs text-red-500">{controller.labelError}</p>
        )}
        <button
          onClick={controller.handleTestAction}
          disabled={!controller.canRunTest || controller.isTestInvoking}
          className="mt-2 w-full py-1 text-sm rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
        >
          {controller.runButtonLabel}
        </button>

        <AnimatePresence>
          {controller.expanded && (
            <motion.div
              key="expanded-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2"
            >
              {planRestrictionMessage ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
                  <div className="flex items-start justify-between gap-2">
                    <span>{planRestrictionMessage}</span>
                    <button
                      type="button"
                      onClick={controller.handlePlanUpgradeClick}
                      className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-400/10"
                    >
                      Upgrade
                    </button>
                  </div>
                </div>
              ) : null}

              <SlackAction
                nodeId={id}
                canEdit={effectiveCanEdit}
                isRestricted={isRestricted}
              />

              <p className="text-xs text-zinc-500">Execution Options</p>
              <div className="flex gap-2 items-center">
                <NodeInputField
                  type="number"
                  value={String(controller.timeout)}
                  onChange={(value) => {
                    controller.handleTimeoutChange(Number(value))
                  }}
                  className="w-20 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                />
                <span className="text-xs">ms timeout</span>
                <NodeInputField
                  type="number"
                  value={String(controller.retries)}
                  onChange={(value) => {
                    controller.handleRetriesChange(Number(value))
                  }}
                  className="w-12 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                />
                <span className="text-xs">retries</span>
                <NodeCheckBoxField
                  checked={controller.stopOnError}
                  onChange={(value) => {
                    controller.handleStopOnErrorChange(value)
                  }}
                >
                  Stop on error
                </NodeCheckBoxField>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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

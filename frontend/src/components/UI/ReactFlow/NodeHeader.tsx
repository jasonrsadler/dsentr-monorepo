import { ArrowUpRight, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import NodeTitleInputField from '../InputFields/NodeTitleInputField'
import { useWorkflowFlyout } from '@/components/workflow/useWorkflowFlyout'

interface NodeHeaderProps {
  nodeId: string
  label: string
  dirty: boolean
  hasValidationErrors: boolean
  expanded: boolean
  onLabelChange: (label: string) => void
  onExpanded: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void
  onConfirmingDelete: (
    event: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => void
}

export default function NodeHeader({
  nodeId,
  label,
  dirty,
  hasValidationErrors,
  expanded,
  onLabelChange,
  onExpanded,
  onConfirmingDelete
}: NodeHeaderProps) {
  const { openFlyout, activeNodeId, isFlyoutRender } = useWorkflowFlyout()
  const isActive = activeNodeId === nodeId
  const showFlyoutButton = !isFlyoutRender

  return (
    <div className="flex justify-between items-center">
      <NodeTitleInputField
        label={label}
        onLabelChange={onLabelChange}
        dirty={dirty}
        hasValidationErrors={hasValidationErrors}
      />
      <div className="flex items-center gap-1">
        {showFlyoutButton ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openFlyout(nodeId)
            }}
            className={`p-1 rounded transition text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${isActive ? 'opacity-100 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-100' : ''}`}
            title="Open in detail flyout"
            aria-label="Open in detail flyout"
            aria-pressed={isActive}
          >
            <ArrowUpRight size={16} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onExpanded}
          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <button
          type="button"
          onClick={onConfirmingDelete}
          className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
          title="Delete node"
        >
          <Trash2 size={16} className="text-red-600" />
        </button>
      </div>
    </div>
  )
}

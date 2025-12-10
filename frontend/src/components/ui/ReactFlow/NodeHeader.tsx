import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import NodeTitleInputField from '../InputFields/NodeTitleInputField'
import { useWorkflowFlyout } from '@/components/workflow/useWorkflowFlyout'

interface NodeHeaderProps {
  nodeId: string
  label: string
  dirty: boolean
  hasValidationErrors: boolean
  expanded: boolean
  showExpandToggle?: boolean
  onLabelChange: (label: string) => void
  onExpanded: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void
  onConfirmingDelete: (
    event: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => void
}

export default function NodeHeader({
  label,
  dirty,
  hasValidationErrors,
  expanded,
  showExpandToggle = true,
  onLabelChange,
  onExpanded,
  onConfirmingDelete
}: NodeHeaderProps) {
  const { isFlyoutRender } = useWorkflowFlyout()
  const showExpandButton = !isFlyoutRender && showExpandToggle

  return (
    <div className="flex justify-between items-center">
      <NodeTitleInputField
        label={label}
        onLabelChange={onLabelChange}
        dirty={dirty}
        hasValidationErrors={hasValidationErrors}
      />
      <div className="flex items-center gap-1">
        {showExpandButton ? (
          <button
            type="button"
            onClick={onExpanded}
            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        ) : null}
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

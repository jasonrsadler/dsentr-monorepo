import { ChevronDown, ChevronUp, Trash2 } from "lucide-react"
import NodeTitleInputField from "../InputFields/NodeTitleInputField"

interface NodeHeaderProps {
  label: string
  dirty: boolean
  hasValidationErrors: boolean
  expanded: boolean
  onLabelChange: (label: string) => void
  onExpanded: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void
  onConfirmingDelete: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void
}

export default function NodeHeader({
  label,
  dirty,
  hasValidationErrors,
  expanded,
  onLabelChange,
  onExpanded,
  onConfirmingDelete
}: NodeHeaderProps) {
  return (
    <div className="flex justify-between items-center">
      <NodeTitleInputField
        label={label}
        onLabelChange={onLabelChange}
        dirty={dirty}
        hasValidationErrors={hasValidationErrors}
      />
      <div className="flex gap-1">
        <button
          onClick={onExpanded}
          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
          {
            expanded ?
              <ChevronUp size={16} />
              :
              <ChevronDown size={16}
              />
          }
        </button>
        <button
          onClick={onConfirmingDelete}
          className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
          title="Delete node">
          <Trash2 size={16} className="text-red-600" />
        </button>
      </div>
    </div>
  )
}
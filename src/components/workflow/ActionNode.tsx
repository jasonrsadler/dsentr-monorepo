import ActionIcon from '@/assets/svg-components/ActionIcon'
import { Handle, Position } from '@xyflow/react'

const baseNodeStyle =
  'flex items-center justify-center gap-1 p-3 rounded-xl shadow-md w-40 text-center border-2 transition-all duration-150'

export const ActionNode = ({ data, selected }) => (
  <div
    className={`${baseNodeStyle} bg-blue-600 text-white ${selected ? 'border-yellow-400 ring-2 ring-yellow-300' : 'border-transparent'
      }`}
  >
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
    <ActionIcon />
    <span className="font-medium">{data.label}</span>
  </div>
)

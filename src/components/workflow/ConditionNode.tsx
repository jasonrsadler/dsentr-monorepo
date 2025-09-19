import ConditionIcon from '@/assets/svg-components/ConditionIcon'
import { Handle, Position } from '@xyflow/react'

const baseNodeStyle =
  'flex items-center justify-center gap-1 p-3 rounded-xl shadow-md w-40 text-center border-2 transition-all duration-150'

export const ConditionNode = ({ data, selected }) => (
  <div
    className={`${baseNodeStyle} bg-yellow-400 text-black ${selected ? 'border-yellow-600 ring-2 ring-yellow-500' : 'border-transparent'
      }`}
  >
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
    <ConditionIcon />
    <span className="font-medium">{data.label}</span>
  </div>
)

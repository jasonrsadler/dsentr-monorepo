import {
  BaseEdge,
  getBezierPath,
  type Edge,
  type EdgeProps
} from '@xyflow/react'
import { Trash2 } from 'lucide-react'

type NodeEdgeVariant = 'default' | 'bold' | 'dashed'

type NodeEdgeProps = EdgeProps<Edge<Record<string, unknown>>> & {
  onDelete?: (id: string) => void
  onChangeType?: (id: string, edgeType: NodeEdgeVariant) => void
}

export default function NodeEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  selected,
  data,
  markerEnd,
  onDelete,
  onChangeType
}: NodeEdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  })

  const edgeType = (data?.edgeType as NodeEdgeVariant | undefined) ?? 'default'

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          ...style,
          strokeWidth: edgeType === 'bold' ? 3 : 1,
          strokeDasharray: edgeType === 'dashed' ? '4 4' : '0'
        }}
        markerEnd={markerEnd}
      />
      {selected && (
        <foreignObject width={220} height={45} x={labelX - 90} y={labelY - 75}>
          <div className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded shadow text-xs">
            <button
              onClick={() => onDelete?.(id)}
              className="flex items-center justify-center p-3 hover:bg-red-100 dark:hover:bg-red-900 hover:text-white rounded"
              title="Delete edge"
            >
              <Trash2 size={18} className="text-red-600" />
            </button>
            <span className="text-xs text-zinc-700 dark:text-zinc-300">
              Type:
            </span>
            <select
              title="Edge Type"
              value={edgeType}
              onChange={(e) =>
                onChangeType?.(id, e.target.value as NodeEdgeVariant)
              }
              className="px-8 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs"
            >
              <option value="default">Default</option>
              <option value="bold">Bold</option>
              <option value="dashed">Dashed</option>
            </select>
          </div>
        </foreignObject>
      )}
    </>
  )
}

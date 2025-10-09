import { motion, AnimatePresence } from "framer-motion"
import { Handle, Position } from "@xyflow/react"
import { ChevronUp, ChevronDown, Trash2 } from "lucide-react"

export default function BaseNode({
  id,
  selected,
  label,
  dirty,
  expanded,
  setExpanded,
  onRemove,
  children,
}) {
  return (
    <motion.div
      layout
      className={`relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? "ring-2 ring-blue-500" : "border-zinc-300 dark:border-zinc-700"
        }`}
      style={{
        width: expanded ? "auto" : 256,
        minWidth: expanded ? 256 : undefined,
        maxWidth: expanded ? 400 : undefined,
      }}
    >
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 14, height: 14, backgroundColor: "green", border: "2px solid white" }}
      />
      <div className="p-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold cursor-pointer relative">
            {label}
            {dirty && (
              <span className="absolute -right-3 top-1 w-2 h-2 rounded-full bg-blue-500" />
            )}
          </h3>
          <div className="flex gap-1">
            <button
              onClick={() => setExpanded(prev => !prev)}
              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            <button
              onClick={() => onRemove?.(id)}
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
              title="Delete node"
            >
              <Trash2 size={16} className="text-red-600" />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              key="expanded-content"
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

import { useState, useRef, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Handle, Position } from "@xyflow/react"
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react"
import TriggerTypeDropdown from "./TriggerTypeDropdown"
// import TriggerTypeDropdown from "./TriggerTypeDropdown"

export default function TriggerNode({
  id,
  data,
  selected,
  onLabelChange,
  onRun,
  onRemove,
  onDirtyChange,
  onUpdateNode
}) {
  const isNewNode = !data?.id
  const [label, setLabel] = useState(data?.label ?? "Manual Trigger")
  const [expanded, setExpanded] = useState(data?.expanded ?? false)
  const [inputs, setInputs] = useState(data?.inputs ?? [])
  const [dirty, setDirty] = useState(data?.dirty ?? isNewNode)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const inputRefs = useRef([])

  useEffect(() => {
    if (data?.dirty !== undefined && data.dirty !== dirty) {
      setDirty(data.dirty)
    }
  }, [data?.dirty])

  useEffect(() => {
    // notify node update; suppress marking workflow dirty if clearing programmatically
    onUpdateNode?.(id, { label, inputs, dirty, expanded }, true)
    if (dirty) {
      onDirtyChange?.(dirty, { label, inputs, expanded })
    }
  }, [label, inputs, dirty, expanded, id, onDirtyChange, onUpdateNode])

  const hasInvalidInputs = useMemo(() => {
    if (inputs.length === 0) return false
    return inputs.some(i => !i.key.trim() || !i.value.trim())
  }, [inputs])

  const hasDuplicateKeys = useMemo(() => {
    const keys = inputs.map(i => i.key.trim()).filter(k => k)
    return new Set(keys).size !== keys.length
  }, [inputs])

  const updateInput = (index, field, value) => {
    setInputs(prev => {
      const updated = [...prev]
      updated[index][field] = value
      setDirty(true)
      return updated
    })
  }

  const addInput = () => {
    setInputs(prev => [...prev, { key: "", value: "" }])
    setDirty(true)
  }
  const removeInput = index => {
    setInputs(prev => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  const handleRun = async () => {
    setRunning(true)
    try { await onRun?.(id, inputs) } finally { setRunning(false) }
  }

  return (
    <motion.div layout className={`relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? "ring-2 ring-blue-500" : "border-zinc-300 dark:border-zinc-700"}`} style={{ width: expanded ? "auto" : 256, minWidth: expanded ? 256 : undefined, maxWidth: expanded ? 400 : undefined }}>
      <Handle type="source" position={Position.Right} style={{ width: 14, height: 14, backgroundColor: "green", border: "2px solid white" }} />
      <div className="p-3">
        <div className="flex justify-between items-center">
          {editing ? (
            <input
              value={label}
              onChange={e => {
                setLabel(e.target.value)
                setDirty(true)
              }}
              onBlur={() => { setEditing(false); onLabelChange?.(id, label) }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  e.currentTarget.blur()  // triggers onBlur
                }
              }}
              className="text-sm font-semibold bg-transparent border-b border-zinc-400 focus:outline-none w-full"
            />
          ) : (
            <h3 onDoubleClick={() => setEditing(true)} className="text-sm font-semibold cursor-pointer relative">
              {label}{dirty && <span className="absolute -right-3 top-1 w-2 h-2 rounded-full bg-blue-500" />}
            </h3>
          )}
          <div className="flex gap-1">
            <button onClick={() => setExpanded(prev => !prev)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
            <button onClick={() => setConfirmingDelete(true)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded" title="Delete node"><Trash2 size={16} className="text-red-600" /></button>
          </div>
        </div>

        <button onClick={handleRun} disabled={running || hasDuplicateKeys || hasInvalidInputs} className="mt-2 w-full py-1 text-sm rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
          {running ? "Running..." : "Run"}
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div key="expanded-content" layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2">
              <p className="text-xs text-zinc-500 mt-2">Trigger Type</p>
              <TriggerTypeDropdown
                value={data?.triggerType || "Manual"}
                onChange={(type) => {
                  onUpdateNode?.(id, { triggerType: type, dirty: true })
                  setDirty(true)
                }}
              />
              <p className="text-xs text-zinc-500">Input Variables</p>
              <div className="space-y-2">
                {inputs.map((input, index) => (
                  <div key={index} className="flex gap-1">
                    <input ref={el => (inputRefs.current[index] = el)} value={input.key} onChange={e => updateInput(index, "key", e.target.value)} placeholder="key" className="flex-1 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent" />
                    <input value={input.value} onChange={e => updateInput(index, "value", e.target.value)} placeholder="value" className="flex-1 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent" />
                    <button onClick={() => removeInput(index)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"><Trash2 size={14} className="text-red-500" /></button>
                  </div>
                ))}
                <button onClick={addInput} className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"><Plus size={14} /> Add variable</button>
                {hasDuplicateKeys && (
                  <p className="text-xs text-red-500">Duplicate keys are not allowed</p>
                )}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {confirmingDelete && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl">
            <div className="bg-white dark:bg-zinc-800 p-4 rounded-xl shadow-md w-56">
              <p className="text-sm mb-3">Delete this node?</p>
              <p className="text-sm mb-3">This action can not be undone</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmingDelete(false)} className="px-2 py-1 text-xs rounded border">Cancel</button>
                <button onClick={() => { setConfirmingDelete(false); onRemove?.(id) }} className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600">Delete</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

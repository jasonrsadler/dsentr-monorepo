import { useState, useEffect } from "react"
import { Trash2, Plus } from "lucide-react"

interface KeyValuePairProps {
  title?: string
  variables?: { key: string; value: string }[]
  onChange?: (variables: { key: string; value: string }[], hasErrors: boolean, dirty: boolean) => void
  placeholderKey?: string
  placeholderValue?: string
}

export default function KeyValuePair({
  title = "Variables",
  variables = [],
  onChange,
  placeholderKey = "key",
  placeholderValue = "value"
}: KeyValuePairProps) {
  const [vars, setVars] = useState(variables || [])
  const [_, setDirty] = useState(false)

  useEffect(() => {
    setVars(variables || [])
  }, [variables])

  const checkVars = (vars: { key: string, value: string }[] = []) => {
    const normalized = vars.map((v: { key: string, value: string }) => ({
      key: v?.key?.toString() || "",
      value: v?.value?.toString() || ""
    }))
    const keys = normalized.map(v => v.key.trim()).filter(Boolean)
    const anyBlank = normalized.some(v => !v.key.trim() || !v.value.trim())
    const hasDuplicateKeys = new Set(keys).size !== keys.length
    return anyBlank || hasDuplicateKeys
  }

  const handleUpdate = (updatedVars: { key: string; value: string; }[]) => {
    setVars(updatedVars)
    setDirty(true)
    const nodeHasErrors = checkVars(updatedVars)
    onChange?.(updatedVars, nodeHasErrors, true)
  }

  const updateVar = (index: number, field: string, value: string) => {
    const updated = vars.map((v, i) => i === index ? { ...v, [field]: value } : v)
    handleUpdate(updated)
  }

  const removeVar = (index: number) => {
    handleUpdate(vars.filter((_, i) => i !== index))
  }

  const addVar = () => {
    handleUpdate([...vars, { key: "", value: "" }])
  }

  const inputClass = "text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-zinc-500"

  const hasErrors = checkVars(vars)

  return (
    <div className="flex flex-col gap-1 mt-2">
      <p className="text-xs text-zinc-500">{title}</p>
      {vars.map((v, index) => (
        <div key={index} className="flex gap-1">
          <input
            type="text"
            placeholder={placeholderKey}
            className={inputClass}
            value={v.key}
            onChange={e => updateVar(index, "key", e.target.value)}
          />
          <input
            type="text"
            placeholder={placeholderValue}
            className={inputClass}
            value={v.value}
            onChange={e => updateVar(index, "value", e.target.value)}
          />
          <button onClick={() => removeVar(index)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded">
            <Trash2 size={14} className="text-red-500" />
          </button>
        </div>
      ))}
      <button onClick={addVar} className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
        <Plus size={14} /> Add variable
      </button>
      {hasErrors && <p className="text-xs text-red-500 mt-1">Variables must have unique, non-empty keys and values</p>}
    </div>
  )
}

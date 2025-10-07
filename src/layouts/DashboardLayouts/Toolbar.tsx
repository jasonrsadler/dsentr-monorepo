import { useEffect, useState } from "react"

export default function WorkflowToolbar({ workflow, onSave, onNew, onSelect, onRename, dirty, saving = false }) {
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(workflow?.name || "")

  useEffect(() => {
    setName(workflow?.name || "")
  }, [workflow?.id, workflow?.name])

  const handleRename = () => {
    if (name.trim() && name !== workflow?.name) {
      onRename?.(workflow.id, name.trim())
    }
    setEditingName(false)
  }

  const isSavingDisabled = !dirty || saving

  return (
    <div className="flex items-center gap-2 p-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <select
        value={workflow?.id}
        onChange={(e) => onSelect?.(e.target.value)}
        className="px-2 py-1 border rounded bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600"
      >
        {workflow?.list?.map((wf) => (
          <option key={wf.id} value={wf.id} className="bg-white dark:bg-zinc-800">
            {wf.name}
          </option>
        ))}
      </select>

      {editingName ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => e.key === "Enter" && handleRename()}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600"
          autoFocus
        />
      ) : (
        <button
          onClick={() => setEditingName(true)}
          className="px-2 py-1 border rounded bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        >
          Rename
        </button>
      )}

      <button onClick={onNew} className="px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600">
        New Workflow
      </button>

      <button
        onClick={onSave}
        disabled={isSavingDisabled}
        className={`px-2 py-1 rounded ${isSavingDisabled ? "bg-zinc-300 text-zinc-600 cursor-not-allowed" : "bg-green-500 text-white hover:bg-green-600"}`}
      >
        {saving ? "Saving..." : "Save"}
      </button>

      {dirty && !saving && <span className="w-2 h-2 rounded-full bg-blue-500" />}
    </div>
  )
}



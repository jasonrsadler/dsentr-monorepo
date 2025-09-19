// WorkflowToolbar.tsx
import { useState } from "react"

export default function WorkflowToolbar({ workflow, onSave, onNew, onSelect, dirty }) {
  return (
    <div className="flex items-center gap-2 p-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <select
        value={workflow?.id}
        onChange={(e) => onSelect?.(e.target.value)}
        className="px-2 py-1 border rounded"
      >
        {workflow?.list?.map((wf) => (
          <option key={wf.id} value={wf.id}>{wf.name}</option>
        ))}
      </select>

      <button onClick={onNew} className="px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600">New Workflow</button>

      <button
        onClick={onSave}
        disabled={!dirty}
        className={`px-2 py-1 rounded ${dirty ? "bg-green-500 text-white hover:bg-green-600" : "bg-zinc-300 text-zinc-600 cursor-not-allowed"}`}
      >
        Save
      </button>

      {dirty && <span className="w-2 h-2 rounded-full bg-blue-500" />}
    </div>
  )
}

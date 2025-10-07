import { useState, useMemo } from 'react'
import { deleteWorkflow, WorkflowRecord } from '@/lib/workflowApi'

type Props = {
  workflows: WorkflowRecord[]
  onDeleted: (id: string) => void
}

export default function WorkflowsTab({ workflows, onDeleted }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(workflows[0]?.id ?? null)
  const selected = useMemo(() => workflows.find(w => w.id === selectedId) ?? null, [workflows, selectedId])
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const canDelete = Boolean(selected) && confirmText.trim() === (selected?.name ?? '') && !busy

  async function handleDelete() {
    if (!selected || !canDelete) return
    try {
      setBusy(true)
      await deleteWorkflow(selected.id)
      onDeleted(selected.id)
      setConfirmText('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Workflows</label>
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
        >
          {workflows.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <h3 className="font-semibold mb-2">Delete workflow</h3>
        <p className="text-sm mb-2">Type the workflow name to confirm deletion.</p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={selected?.name ?? ''}
          className="w-full px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
        />
        <button
          onClick={handleDelete}
          disabled={!canDelete}
          className={`mt-3 px-3 py-1 rounded ${canDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-zinc-300 text-zinc-600 cursor-not-allowed'}`}
        >
          {busy ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  )
}


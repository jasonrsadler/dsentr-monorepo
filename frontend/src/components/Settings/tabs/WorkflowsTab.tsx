import { useEffect, useMemo, useState } from 'react'
import {
  deleteWorkflow,
  listWorkflows,
  WorkflowRecord
} from '@/lib/workflowApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'

type Props = {
  workflows?: WorkflowRecord[]
  onDeleted?: (id: string) => void
}

export default function WorkflowsTab({
  workflows: propWorkflows,
  onDeleted
}: Props) {
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const activeWorkspaceId = currentWorkspace?.workspace.id ?? null
  const [items, setItems] = useState<WorkflowRecord[]>(propWorkflows ?? [])
  useEffect(() => {
    setItems(propWorkflows ?? [])
  }, [propWorkflows])
  useEffect(() => {
    if (!propWorkflows || propWorkflows.length === 0) {
      listWorkflows(activeWorkspaceId)
        .then(setItems)
        .catch(() => {})
    }
  }, [propWorkflows, activeWorkspaceId])

  const [selectedId, setSelectedId] = useState<string | null>(
    items[0]?.id ?? null
  )
  useEffect(() => {
    if (!selectedId && items[0]) setSelectedId(items[0].id)
  }, [items, selectedId])
  const selected = useMemo(
    () => items.find((w) => w.id === selectedId) ?? null,
    [items, selectedId]
  )
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const canDelete =
    Boolean(selected) && confirmText.trim() === (selected?.name ?? '') && !busy

  async function handleDelete() {
    if (!selected || !canDelete) return
    try {
      setBusy(true)
      await deleteWorkflow(selected.id, activeWorkspaceId)
      if (onDeleted) onDeleted(selected.id)
      setItems((prev) => prev.filter((w) => w.id !== selected.id))
      // Try to select the next available workflow locally
      const next = items.find((w) => w.id !== selected.id)
      setSelectedId(next?.id ?? null)
      setConfirmText('')
      try {
        window.dispatchEvent(
          new CustomEvent('workflow-deleted', { detail: { id: selected.id } })
        )
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message)
        } else {
          console.error(error)
        }
      }
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-4 relative">
      <div>
        <label className="block text-sm font-medium mb-1">Workflows</label>
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
        >
          {items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <h3 className="font-semibold mb-2">Delete workflow</h3>
        <p className="text-sm mb-2">
          Type the workflow name to confirm deletion.
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={selected?.name ?? ''}
          className="w-full px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
        />
        <button
          onClick={() => setConfirming(true)}
          disabled={!canDelete}
          className={`mt-3 px-3 py-1 rounded ${canDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-zinc-300 text-zinc-600 cursor-not-allowed'}`}
        >
          Delete
        </button>
      </div>

      {confirming && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
          <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow-xl w-80 border border-zinc-200 dark:border-zinc-700">
            <p className="text-sm mb-2">Delete workflow “{selected?.name}”?</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-4">
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-1 text-xs rounded border"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import {
  deleteWorkflow,
  listWorkflows,
  WorkflowRecord
} from '@/lib/workflowApi'
import {
  fetchRunawayProtectionSetting,
  updateRunawayProtectionSetting
} from '@/lib/optionsApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { errorMessage } from '@/lib/errorMessage'

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
  const [runawayProtectionEnabled, setRunawayProtectionEnabled] = useState(true)
  const [runawayBusy, setRunawayBusy] = useState(false)
  const [runawayError, setRunawayError] = useState<string | null>(null)
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

  useEffect(() => {
    if (!activeWorkspaceId) {
      setRunawayProtectionEnabled(true)
      setRunawayError(null)
      return
    }
    setRunawayBusy(true)
    fetchRunawayProtectionSetting(activeWorkspaceId)
      .then((enabled) => {
        setRunawayProtectionEnabled(enabled)
        setRunawayError(null)
      })
      .catch((err) => {
        console.error(errorMessage(err))
        setRunawayProtectionEnabled(true)
        setRunawayError('Failed to load runaway protection setting.')
      })
      .finally(() => setRunawayBusy(false))
  }, [activeWorkspaceId])

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

  async function handleToggleRunaway(next: boolean) {
    if (!activeWorkspaceId) return
    const previous = runawayProtectionEnabled
    setRunawayProtectionEnabled(next)
    setRunawayError(null)
    setRunawayBusy(true)
    try {
      await updateRunawayProtectionSetting(activeWorkspaceId, next)
    } catch (err) {
      console.error(errorMessage(err))
      setRunawayProtectionEnabled(previous)
      setRunawayError('Failed to update runaway protection.')
    } finally {
      setRunawayBusy(false)
    }
  }

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
      } catch (e) {
        console.error(errorMessage(e))
      }
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-4 relative">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Runaway Protection</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Stops infinite loops from burning usage.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={runawayProtectionEnabled}
              onChange={(e) => handleToggleRunaway(e.target.checked)}
              disabled={runawayBusy || !activeWorkspaceId}
              className="h-4 w-4"
            />
            <span className="text-zinc-700 dark:text-zinc-200">
              {runawayBusy
                ? 'Saving...'
                : runawayProtectionEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </span>
          </label>
        </div>
        {!activeWorkspaceId ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Select a workspace to manage runaway protection.
          </p>
        ) : null}
        {runawayError ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
            {runawayError}
          </p>
        ) : null}
      </div>
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

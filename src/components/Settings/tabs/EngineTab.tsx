import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/stores/auth'
import { listWorkflows, type WorkflowRecord, setConcurrencyLimit, cancelAllRunsForWorkflow, listDeadLetters, requeueDeadLetter, purgeRuns } from '@/lib/workflowApi'

export default function EngineTab() {
  const { user } = useAuth()
  const isAdmin = (user?.role ?? '').toLowerCase() === 'admin'
  const [items, setItems] = useState<WorkflowRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listWorkflows().then(ws => { if (!alive) return; setItems(ws); if (!selectedId && ws[0]) setSelectedId(ws[0].id) }).catch(() => {}).finally(() => setLoading(false))
    return () => { alive = false }
  }, [])

  const selected = useMemo(() => items.find(w => w.id === selectedId) ?? null, [items, selectedId])
  const [limitInput, setLimitInput] = useState<string>('')
  useEffect(() => {
    const current = (selected as any)?.concurrency_limit
    setLimitInput(typeof current === 'number' ? String(current) : '')
  }, [selected?.id])

  const [busy, setBusy] = useState(false)
  const [deadLetters, setDeadLetters] = useState<any[]>([])
  const [dlBusyId, setDlBusyId] = useState<string | null>(null)
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [purgeDays, setPurgeDays] = useState('')

  async function handleSaveLimit() {
    if (!selected || busy) return
    const parsed = parseInt(limitInput || '0', 10)
    if (!Number.isFinite(parsed) || parsed < 1) { setError('Limit must be a positive integer'); return }
    try { setBusy(true); setError(null); const res = await setConcurrencyLimit(selected.id, parsed); if (res.success) {
      setItems(prev => prev.map(w => w.id === selected.id ? { ...w, concurrency_limit: res.limit } as any : w))
    } } catch (e: any) { setError(e?.message || 'Failed to set limit') } finally { setBusy(false) }
  }

  async function handleCancelAll() {
    if (!selected || busy) return
    try { setBusy(true); setError(null); await cancelAllRunsForWorkflow(selected.id) } catch (e: any) { setError(e?.message || 'Failed to cancel runs') } finally { setBusy(false) }
  }

  async function refreshDeadLetters() {
    if (!selected) return
    try { const items = await listDeadLetters(selected.id, 1, 50); setDeadLetters(items) } catch { /* ignore */ }
  }
  useEffect(() => { refreshDeadLetters() }, [selected?.id])

  async function handleRequeue(id: string) {
    if (!selected) return
    try { setDlBusyId(id); await requeueDeadLetter(selected.id, id); await refreshDeadLetters() } finally { setDlBusyId(null) }
  }

  async function handlePurge() {
    if (!isAdmin) return
    const days = purgeDays ? parseInt(purgeDays, 10) : undefined
    try { setPurgeBusy(true); setError(null); await purgeRuns(days) } catch (e: any) { setError(e?.message || 'Failed to purge') } finally { setPurgeBusy(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1">Workflow</label>
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
          disabled={loading}
        >
          {items.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <h3 className="font-semibold mb-2">Concurrency</h3>
        <div className="flex items-center gap-2">
          <input type="number" min={1} step={1} value={limitInput} onChange={(e) => setLimitInput(e.target.value)} className="w-24 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700" />
          <button onClick={handleSaveLimit} disabled={!selected || busy || !limitInput} className={`px-3 py-1 rounded ${busy ? 'opacity-60 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}>Save Limit</button>
        </div>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <h3 className="font-semibold mb-2">Queue</h3>
        <button onClick={handleCancelAll} disabled={!selected || busy} className={`px-3 py-1 rounded ${busy ? 'opacity-60 cursor-not-allowed' : 'bg-yellow-600 text-white hover:bg-yellow-700'}`}>Cancel All Runs</button>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold mb-2">Dead‑Letter Queue</h3>
          <button onClick={refreshDeadLetters} className="text-sm underline">Refresh</button>
        </div>
        {deadLetters.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No dead letters</p>
        ) : (
          <div className="space-y-2">
            {deadLetters.map((d) => (
              <div key={d.id} className="p-2 rounded border bg-white dark:bg-zinc-800 dark:border-zinc-700">
                <div className="text-xs text-zinc-500">{new Date(d.created_at).toLocaleString()} • run {d.run_id}</div>
                <div className="text-sm truncate max-w-full" title={d.error}>{d.error}</div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => handleRequeue(d.id)} disabled={dlBusyId === d.id} className={`px-2 py-1 text-xs rounded ${dlBusyId === d.id ? 'opacity-60 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>Requeue</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <h3 className="font-semibold mb-2">Maintenance</h3>
          <div className="flex items-center gap-2">
            <input type="number" min={1} step={1} placeholder="days" value={purgeDays} onChange={(e) => setPurgeDays(e.target.value)} className="w-24 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700" />
            <button onClick={handlePurge} disabled={purgeBusy} className={`px-3 py-1 rounded ${purgeBusy ? 'opacity-60 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}>Purge Completed Runs</button>
          </div>
        </div>
      )}
    </div>
  )
}


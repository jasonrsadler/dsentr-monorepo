import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/stores/auth'
import {
  listWorkflows,
  type WorkflowRecord,
  setConcurrencyLimit,
  cancelAllRunsForWorkflow,
  listDeadLetters,
  requeueDeadLetter,
  purgeRuns,
  getEgressAllowlist,
  setEgressAllowlistApi,
  listEgressBlocks,
  type EgressBlockEvent,
  clearEgressBlocks,
  clearDeadLetters,
  listRunsForWorkflow,
  getWorkflowRunStatus
} from '@/lib/workflowApi'
import JsonDialog from '@/components/UI/Dialog/JsonDialog'
import { ChevronDown, ChevronUp } from 'lucide-react'

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
    listWorkflows()
      .then((ws) => {
        if (!alive) return
        setItems(ws)
        if (!selectedId && ws[0]) setSelectedId(ws[0].id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const selected = useMemo(
    () => items.find((w) => w.id === selectedId) ?? null,
    [items, selectedId]
  )
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
  const [egressText, setEgressText] = useState('')
  const [egressBusy, setEgressBusy] = useState(false)
  const [egressBlocks, setEgressBlocks] = useState<EgressBlockEvent[]>([])
  const SUCCESSFUL_RUNS_PER_PAGE = 20
  const [successfulRuns, setSuccessfulRuns] = useState<any[]>([])
  const [successfulPage, setSuccessfulPage] = useState(1)
  const [successfulHasMore, setSuccessfulHasMore] = useState(false)
  const [successfulLoading, setSuccessfulLoading] = useState(false)
  const [showSuccessful, setShowSuccessful] = useState(true)
  const [showDead, setShowDead] = useState(true)
  const [showBlocked, setShowBlocked] = useState(true)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonTitle, setJsonTitle] = useState<string>('')
  const [jsonBody, setJsonBody] = useState<string>('')

  async function handleSaveLimit() {
    if (!selected || busy) return
    const parsed = parseInt(limitInput || '0', 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Limit must be a positive integer')
      return
    }
    try {
      setBusy(true)
      setError(null)
      const res = await setConcurrencyLimit(selected.id, parsed)
      if (res.success) {
        setItems((prev) =>
          prev.map((w) =>
            w.id === selected.id
              ? ({ ...w, concurrency_limit: res.limit } as any)
              : w
          )
        )
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to set limit')
    } finally {
      setBusy(false)
    }
  }

  async function handleCancelAll() {
    if (!selected || busy) return
    try {
      setBusy(true)
      setError(null)
      await cancelAllRunsForWorkflow(selected.id)
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel runs')
    } finally {
      setBusy(false)
    }
  }

  async function refreshDeadLetters() {
    if (!selected) return
    try {
      const items = await listDeadLetters(selected.id, 1, 50)
      setDeadLetters(items)
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    refreshDeadLetters()
  }, [selected?.id])

  const refreshSuccessfulRuns = useCallback(
    async (page: number) => {
      if (!selectedId) {
        setSuccessfulRuns([])
        setSuccessfulHasMore(false)
        setSuccessfulPage(1)
        return
      }

      setSuccessfulLoading(true)
      try {
        const items = await listRunsForWorkflow(selectedId, {
          status: ['succeeded'],
          page,
          perPage: SUCCESSFUL_RUNS_PER_PAGE
        })
        setSuccessfulRuns(items)
        setSuccessfulHasMore(items.length === SUCCESSFUL_RUNS_PER_PAGE)
        setSuccessfulPage(page)
      } catch {
        if (page === 1) {
          setSuccessfulRuns([])
          setSuccessfulHasMore(false)
          setSuccessfulPage(1)
        }
      } finally {
        setSuccessfulLoading(false)
      }
    },
    [selectedId]
  )

  useEffect(() => {
    setSuccessfulPage(1)
    refreshSuccessfulRuns(1)
  }, [selectedId, refreshSuccessfulRuns])

  useEffect(() => {
    ;(async () => {
      if (!selected) {
        setEgressText('')
        return
      }
      try {
        const list = await getEgressAllowlist(selected.id)
        setEgressText(list.join('\n'))
      } catch {
        setEgressText('')
      }
    })()
  }, [selected?.id])

  useEffect(() => {
    ;(async () => {
      if (!selected) {
        setEgressBlocks([])
        return
      }
      try {
        const items = await listEgressBlocks(selected.id, 1, 25)
        setEgressBlocks(items)
      } catch {
        setEgressBlocks([])
      }
    })()
  }, [selected?.id])

  async function handleRequeue(id: string) {
    if (!selected) return
    try {
      setDlBusyId(id)
      await requeueDeadLetter(selected.id, id)
      await refreshDeadLetters()
    } finally {
      setDlBusyId(null)
    }
  }

  async function handlePurge() {
    if (!isAdmin) return
    const days = purgeDays ? parseInt(purgeDays, 10) : undefined
    try {
      setPurgeBusy(true)
      setError(null)
      await purgeRuns(days)
    } catch (e: any) {
      setError(e?.message || 'Failed to purge')
    } finally {
      setPurgeBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Workflow selector */}
      <div>
        <label className="block text-sm font-medium mb-1">Workflow</label>
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
          disabled={loading}
        >
          {items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Concurrency */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <h3 className="font-semibold mb-2">Concurrency</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            className="w-24 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
          />
          <button
            onClick={handleSaveLimit}
            disabled={!selected || busy || !limitInput}
            className={`px-3 py-1 rounded ${busy ? 'opacity-60 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
          >
            Save Limit
          </button>
        </div>
      </div>

      {/* Queue actions */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <h3 className="font-semibold mb-2">Queue</h3>
        <button
          onClick={handleCancelAll}
          disabled={!selected || busy}
          className={`px-3 py-1 rounded ${busy ? 'opacity-60 cursor-not-allowed' : 'bg-yellow-600 text-white hover:bg-yellow-700'}`}
        >
          Cancel All Runs
        </button>
      </div>

      {/* Egress allowlist config */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <h3 className="font-semibold mb-2">Egress Allowlist</h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
          One host or wildcard per line (e.g., api.github.com or *.mycorp.com).
          Global allowlist from server is also applied.
        </p>
        <textarea
          value={egressText}
          onChange={(e) => setEgressText(e.target.value)}
          rows={5}
          className="w-full px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700 font-mono text-xs"
        />
        <div className="mt-2">
          <button
            onClick={async () => {
              if (!selected) return
              try {
                setEgressBusy(true)
                const items = egressText
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                await setEgressAllowlistApi(selected.id, items)
              } finally {
                setEgressBusy(false)
              }
            }}
            disabled={!selected || egressBusy}
            className={`px-3 py-1 rounded ${egressBusy ? 'opacity-60 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          >
            Save Allowlist
          </button>
        </div>
      </div>

      {/* Successful Runs */}
      <div className="border rounded-md bg-white dark:bg-zinc-900 dark:border-zinc-700">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            onClick={() => setShowSuccessful((v) => !v)}
            className="flex items-center gap-2 font-semibold"
          >
            {showSuccessful ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
            <span>Successful Runs</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshSuccessfulRuns(successfulPage)}
              disabled={successfulLoading}
              className="text-sm underline disabled:opacity-60"
            >
              Refresh
            </button>
            {showSuccessful && (
              <div className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                <button
                  onClick={() =>
                    refreshSuccessfulRuns(Math.max(1, successfulPage - 1))
                  }
                  disabled={successfulPage === 1 || successfulLoading}
                  className="px-2 py-0.5 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="px-2 py-0.5 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
                  Page {successfulPage}
                </span>
                <button
                  onClick={() => refreshSuccessfulRuns(successfulPage + 1)}
                  disabled={!successfulHasMore || successfulLoading}
                  className="px-2 py-0.5 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
        {showSuccessful && (
          <div className="px-3 pb-3">
            {successfulLoading ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Loading...
              </p>
            ) : successfulRuns.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No successful runs
              </p>
            ) : (
              <div className="space-y-2">
                {successfulRuns.map((r: any) => {
                  const started = r.started_at ? new Date(r.started_at) : null
                  const finished = r.finished_at
                    ? new Date(r.finished_at)
                    : null
                  const durSec =
                    started && finished
                      ? Math.max(
                          0,
                          (finished.getTime() - started.getTime()) / 1000
                        )
                      : null
                  return (
                    <div
                      key={r.id}
                      className="p-2 rounded border bg-white dark:bg-zinc-800 dark:border-zinc-700"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm">
                          <span className="text-zinc-600 dark:text-zinc-400">
                            {started ? started.toLocaleString() : '-'}
                          </span>
                          <span className="mx-1">-&gt;</span>
                          <span className="text-zinc-600 dark:text-zinc-400">
                            {finished ? finished.toLocaleString() : '-'}
                          </span>
                          <span className="mx-2">-</span>
                          <span className="text-zinc-700 dark:text-zinc-200">
                            {durSec !== null ? `${durSec.toFixed(1)}s` : '-'}
                          </span>
                          <span className="mx-2">-</span>
                          <span className="font-mono text-xs">{r.id}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              if (!selected) return
                              try {
                                const data = await getWorkflowRunStatus(
                                  selected.id,
                                  r.id
                                )
                                setJsonTitle(`Run ${r.id}`)
                                setJsonBody(
                                  JSON.stringify(
                                    {
                                      run: data.run,
                                      node_runs: data.node_runs
                                    },
                                    null,
                                    2
                                  )
                                )
                                setJsonOpen(true)
                              } catch (e) {
                                console.error(e.message)
                              }
                            }}
                            className="px-2 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                          >
                            View details
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dead-Letter Queue */}
      <div className="border rounded-md bg-white dark:bg-zinc-900 dark:border-zinc-700">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            onClick={() => setShowDead((v) => !v)}
            className="flex items-center gap-2 font-semibold"
          >
            {showDead ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            <span>Dead-Letter Queue</span>
          </button>
          <div className="flex items-center gap-2">
            <button onClick={refreshDeadLetters} className="text-sm underline">
              Refresh
            </button>
            <button
              onClick={async () => {
                if (selected) {
                  try {
                    await clearDeadLetters(selected.id)
                    await refreshDeadLetters()
                  } catch (e) {
                    console.error(e.message)
                  }
                }
              }}
              className="text-sm underline text-red-600"
            >
              Clear All
            </button>
          </div>
        </div>
        {showDead && (
          <div className="px-3 pb-3">
            {deadLetters.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No dead letters
              </p>
            ) : (
              <div className="space-y-2">
                {deadLetters.map((d) => (
                  <div
                    key={d.id}
                    className="p-2 rounded border bg-white dark:bg-zinc-800 dark:border-zinc-700"
                  >
                    <div className="text-xs text-zinc-500">
                      {new Date(d.created_at).toLocaleString()} - run {d.run_id}
                    </div>
                    <div
                      className="text-sm truncate max-w-full"
                      title={d.error}
                    >
                      {d.error}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => handleRequeue(d.id)}
                        disabled={dlBusyId === d.id}
                        className={`px-2 py-1 text-xs rounded ${dlBusyId === d.id ? 'opacity-60 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                      >
                        Requeue
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Blocked Egress */}
      <div className="border rounded-md bg-white dark:bg-zinc-900 dark:border-zinc-700">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            onClick={() => setShowBlocked((v) => !v)}
            className="flex items-center gap-2 font-semibold"
          >
            {showBlocked ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            <span>Blocked Egress</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (selected) {
                  try {
                    const items = await listEgressBlocks(selected.id, 1, 25)
                    setEgressBlocks(items)
                  } catch (e) {
                    console.error(e.message)
                  }
                }
              }}
              className="text-sm underline"
            >
              Refresh
            </button>
            <button
              onClick={async () => {
                if (selected) {
                  try {
                    await clearEgressBlocks(selected.id)
                    const items = await listEgressBlocks(selected.id, 1, 25)
                    setEgressBlocks(items)
                  } catch (e) {
                    console.error(e.message)
                  }
                }
              }}
              className="text-sm underline text-red-600"
            >
              Clear All
            </button>
          </div>
        </div>
        {showBlocked && (
          <div className="px-3 pb-3">
            {egressBlocks.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No blocked requests recorded.
              </p>
            ) : (
              <div className="space-y-2">
                {egressBlocks.map((b) => (
                  <div
                    key={b.id}
                    className="p-2 rounded border bg-white dark:bg-zinc-800 dark:border-zinc-700"
                  >
                    <div className="text-xs text-zinc-500">
                      {new Date(b.created_at).toLocaleString()} - node{' '}
                      {b.node_id} - {b.rule}
                    </div>
                    <div className="text-sm">
                      <span className="font-mono">{b.host}</span> - {b.message}
                    </div>
                    <div className="text-xs text-zinc-500 break-words">
                      {b.url}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Maintenance */}
      {isAdmin && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <h3 className="font-semibold mb-2">Maintenance</h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              placeholder="days"
              value={purgeDays}
              onChange={(e) => setPurgeDays(e.target.value)}
              className="w-24 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
            />
            <button
              onClick={handlePurge}
              disabled={purgeBusy}
              className={`px-3 py-1 rounded ${purgeBusy ? 'opacity-60 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}
            >
              Purge Completed Runs
            </button>
          </div>
        </div>
      )}

      <JsonDialog
        isOpen={jsonOpen}
        title={jsonTitle}
        jsonText={jsonBody}
        onClose={() => setJsonOpen(false)}
      />
    </div>
  )
}

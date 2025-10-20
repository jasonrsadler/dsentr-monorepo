import { useCallback, useEffect, useMemo, useState } from 'react'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import {
  listWorkflows,
  type WorkflowRecord,
  setConcurrencyLimit,
  cancelAllRunsForWorkflow,
  listDeadLetters,
  type DeadLetter,
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
import { useSecrets } from '@/contexts/SecretsContext'
import {
  flattenSecretValues,
  maskSecretsDeep,
  maskStringWithSecrets
} from '@/lib/secretMask'
import { normalizePlanTier } from '@/lib/planTiers'

const CONCURRENCY_RESTRICTION_MESSAGE =
  'Solo plan workflows run one job at a time. Upgrade in Settings → Plan to raise the concurrency limit.'

const describeActorMetadata = (meta: any): string | null => {
  if (!meta) return null
  if (typeof meta === 'string') return meta
  if (typeof meta !== 'object') return null
  if (typeof meta.label === 'string' && meta.label.trim()) {
    return meta.label.trim()
  }
  const parts: string[] = []
  if (typeof meta.name === 'string' && meta.name.trim()) {
    parts.push(meta.name.trim())
  }
  if (typeof meta.email === 'string' && meta.email.trim()) {
    parts.push(meta.email.trim())
  }
  if (typeof meta.type === 'string' && meta.type.trim()) {
    const formatted = meta.type
      .trim()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char: string) => char.toUpperCase())
    if (!parts.includes(formatted)) parts.push(formatted)
  }
  return parts.length ? parts.join(' · ') : null
}

const describeCredentialMetadata = (meta: any): string | null => {
  if (!meta) return null
  if (typeof meta === 'string') return meta
  if (typeof meta !== 'object') return null
  if (typeof meta.label === 'string' && meta.label.trim()) {
    return meta.label.trim()
  }
  const provider =
    typeof meta.provider === 'string' && meta.provider.trim()
      ? meta.provider.trim()
      : ''
  const scope =
    typeof meta.scope === 'string' && meta.scope.trim()
      ? meta.scope.trim().replace(/_/g, ' ')
      : ''
  const header = [provider, scope].filter(Boolean).join(' · ')
  const account =
    typeof meta.account_email === 'string' && meta.account_email.trim()
      ? meta.account_email.trim()
      : ''
  const workspace =
    typeof meta.workspace_name === 'string' && meta.workspace_name.trim()
      ? meta.workspace_name.trim()
      : ''
  const details = [account, workspace].filter(Boolean).join(' · ')
  const parts = [header, details].filter(Boolean)
  return parts.length ? parts.join(' — ') : null
}

export default function EngineTab() {
  const user = useAuth((state) => state.user)
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const activeWorkspaceId = currentWorkspace?.workspace.id ?? null
  const isAdmin = (user?.role ?? '').toLowerCase() === 'admin'
  const workspaceRole = (currentWorkspace?.role ?? '').toLowerCase()
  const canAdministerEngine =
    workspaceRole === 'owner' || workspaceRole === 'admin'
  const planTier = normalizePlanTier(
    currentWorkspace?.workspace.plan ?? user?.plan ?? undefined
  )
  const isSoloPlan = planTier === 'solo'
  const openPlanSettings = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error((err as Error).message)
    }
  }, [])
  const [items, setItems] = useState<WorkflowRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planRestrictionNotice, setPlanRestrictionNotice] = useState<
    string | null
  >(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listWorkflows(activeWorkspaceId)
      .then((ws) => {
        if (!alive) return
        setItems(ws)
        setSelectedId((prev) => {
          if (prev && ws.some((w) => w.id === prev)) {
            return prev
          }
          return ws[0]?.id ?? null
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => {
      alive = false
    }
  }, [activeWorkspaceId])

  const selected = useMemo(
    () => items.find((w) => w.id === selectedId) ?? null,
    [items, selectedId]
  )
  const selectedWorkflowId = selected?.id ?? null
  const baselineLimit = useMemo(() => {
    const raw = (selected as any)?.concurrency_limit
    return typeof raw === 'number' && raw >= 1 ? raw : 1
  }, [selected?.concurrency_limit, selectedId])
  const [limitInput, setLimitInput] = useState<string>('')
  useEffect(() => {
    if (isSoloPlan) {
      setLimitInput('1')
      setPlanRestrictionNotice(null)
      return
    }
    setLimitInput(String(baselineLimit))
  }, [baselineLimit, isSoloPlan, selectedWorkflowId])
  useEffect(() => {
    setPlanRestrictionNotice(null)
  }, [selectedId, isSoloPlan])

  const [busy, setBusy] = useState(false)
  const parsedLimit = Number.parseInt(limitInput || '', 10)
  const limitInputValid = Number.isFinite(parsedLimit) && parsedLimit >= 1
  const hasLimitChange = limitInputValid && parsedLimit !== baselineLimit
  const canSaveLimit =
    Boolean(selected) &&
    !busy &&
    limitInputValid &&
    hasLimitChange &&
    !isSoloPlan &&
    canAdministerEngine
  const adminOnlyTooltip =
    'Only workspace owners or admins can perform this action.'
  const adminOnlySuffix = canAdministerEngine ? '' : ' (owners/admins only)'
  const adminOnlyTitle = canAdministerEngine ? undefined : adminOnlyTooltip
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
  const { secrets } = useSecrets()
  const secretValues = useMemo(() => flattenSecretValues(secrets), [secrets])
  const sanitizeDeadLetters = useCallback(
    (items: DeadLetter[]) =>
      items.map((item) => ({
        ...item,
        error: maskStringWithSecrets(item.error, secretValues)
      })),
    [secretValues]
  )
  const sanitizeEgress = useCallback(
    (items: EgressBlockEvent[]) =>
      items.map((item) => ({
        ...item,
        host: maskStringWithSecrets(item.host ?? '', secretValues),
        message: maskStringWithSecrets(item.message ?? '', secretValues),
        url: maskStringWithSecrets(item.url ?? '', secretValues)
      })),
    [secretValues]
  )

  async function handleSaveLimit() {
    if (!selected || busy || !canAdministerEngine) return
    const parsed = Number.parseInt(limitInput || '0', 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Limit must be a positive integer')
      return
    }
    if (isSoloPlan) {
      setError(null)
      setPlanRestrictionNotice(CONCURRENCY_RESTRICTION_MESSAGE)
      setLimitInput('1')
      return
    }
    try {
      setBusy(true)
      setError(null)
      setPlanRestrictionNotice(null)
      const res = await setConcurrencyLimit(selected.id, parsed)
      if (res.success) {
        setItems((prev) =>
          prev.map((w) =>
            w.id === selected.id
              ? ({ ...w, concurrency_limit: res.limit } as any)
              : w
          )
        )
        setLimitInput(String(res.limit))
      }
    } catch (e: any) {
      const violationMessage = Array.isArray(e?.violations)
        ? e.violations[0]?.message
        : null
      if (violationMessage) {
        setError(null)
        setPlanRestrictionNotice(violationMessage)
      } else {
        setError(e?.message || 'Failed to set limit')
      }
      setLimitInput(String(baselineLimit))
    } finally {
      setBusy(false)
    }
  }

  async function handleCancelAll() {
    if (!selected || busy || !canAdministerEngine) return
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

  const refreshDeadLetters = useCallback(async () => {
    if (!selectedWorkflowId) return
    try {
      const items = await listDeadLetters(selectedWorkflowId, 1, 50)
      setDeadLetters(sanitizeDeadLetters(items))
    } catch {
      /* ignore */
    }
  }, [selectedWorkflowId, sanitizeDeadLetters])
  useEffect(() => {
    refreshDeadLetters()
  }, [refreshDeadLetters])

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
      if (!selectedWorkflowId) {
        setEgressText('')
        return
      }
      try {
        const list = await getEgressAllowlist(selectedWorkflowId)
        setEgressText(list.join('\n'))
      } catch {
        setEgressText('')
      }
    })()
  }, [selectedWorkflowId])

  useEffect(() => {
    ;(async () => {
      if (!selectedWorkflowId) {
        setEgressBlocks([])
        return
      }
      try {
        const items = await listEgressBlocks(selectedWorkflowId, 1, 25)
        setEgressBlocks(sanitizeEgress(items))
      } catch {
        setEgressBlocks([])
      }
    })()
  }, [selectedWorkflowId, sanitizeEgress])

  async function handleRequeue(id: string) {
    if (!selectedWorkflowId || !canAdministerEngine) return
    try {
      setDlBusyId(id)
      await requeueDeadLetter(selectedWorkflowId, id)
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
            onChange={(e) => {
              const nextValue = e.target.value
              setLimitInput(nextValue)
              if (isSoloPlan) {
                if (nextValue && nextValue !== '1') {
                  setPlanRestrictionNotice(CONCURRENCY_RESTRICTION_MESSAGE)
                } else {
                  setPlanRestrictionNotice(null)
                }
              }
            }}
            className="w-24 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
            disabled={isSoloPlan || !canAdministerEngine}
          />
          <button
            onClick={handleSaveLimit}
            type="button"
            disabled={!canSaveLimit}
            title={adminOnlyTitle}
            className="px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {`Save Limit${adminOnlySuffix}`}
          </button>
        </div>
        {isSoloPlan ? (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            Solo plan workflows run sequentially. Upgrade in Settings → Plan to
            unlock higher throughput.
          </p>
        ) : null}
        {planRestrictionNotice ? (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="flex items-start justify-between gap-2">
              <span>{planRestrictionNotice}</span>
              <button
                type="button"
                onClick={openPlanSettings}
                className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-400/10"
              >
                Upgrade
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Queue actions */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
        <h3 className="font-semibold mb-2">Queue</h3>
        <button
          onClick={handleCancelAll}
          disabled={!selected || busy || !canAdministerEngine}
          title={adminOnlyTitle}
          className="px-3 py-1 rounded bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {`Cancel All Runs${adminOnlySuffix}`}
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
          readOnly={!canAdministerEngine}
        />
        <div className="mt-2">
          <button
            onClick={async () => {
              if (!selected || !canAdministerEngine) return
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
            disabled={!selected || egressBusy || !canAdministerEngine}
            title={adminOnlyTitle}
            className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {`Save Allowlist${adminOnlySuffix}`}
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
                  const triggeredBy = describeActorMetadata(r.triggered_by)
                  const executedWith = describeCredentialMetadata(
                    r.executed_with
                  )
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
                                const sanitized = maskSecretsDeep(
                                  {
                                    run: data.run,
                                    node_runs: data.node_runs
                                  },
                                  secretValues
                                )
                                setJsonBody(JSON.stringify(sanitized, null, 2))
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
                      {(triggeredBy || executedWith) && (
                        <div className="mt-1 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {triggeredBy && (
                            <div>
                              <span className="font-semibold">
                                Triggered by:
                              </span>{' '}
                              {triggeredBy}
                            </div>
                          )}
                          {executedWith && (
                            <div>
                              <span className="font-semibold">
                                Executed with:
                              </span>{' '}
                              {executedWith}
                            </div>
                          )}
                        </div>
                      )}
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
                if (selectedWorkflowId && canAdministerEngine) {
                  try {
                    await clearDeadLetters(selectedWorkflowId)
                    await refreshDeadLetters()
                  } catch (e) {
                    console.error(e.message)
                  }
                }
              }}
              disabled={!canAdministerEngine}
              title={adminOnlyTitle}
              className="text-sm underline text-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {`Clear All${adminOnlySuffix}`}
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
                      title={maskStringWithSecrets(d.error ?? '', secretValues)}
                    >
                      {maskStringWithSecrets(d.error ?? '', secretValues)}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => handleRequeue(d.id)}
                        disabled={dlBusyId === d.id || !canAdministerEngine}
                        title={adminOnlyTitle}
                        className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {`Requeue${adminOnlySuffix}`}
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
                if (selectedWorkflowId) {
                  try {
                    const items = await listEgressBlocks(
                      selectedWorkflowId,
                      1,
                      25
                    )
                    setEgressBlocks(sanitizeEgress(items))
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
                if (selectedWorkflowId && canAdministerEngine) {
                  try {
                    await clearEgressBlocks(selectedWorkflowId)
                    const items = await listEgressBlocks(
                      selectedWorkflowId,
                      1,
                      25
                    )
                    setEgressBlocks(sanitizeEgress(items))
                  } catch (e) {
                    console.error(e.message)
                  }
                }
              }}
              disabled={!canAdministerEngine}
              title={adminOnlyTitle}
              className="text-sm underline text-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {`Clear All${adminOnlySuffix}`}
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
                      <span className="font-mono">
                        {maskStringWithSecrets(b.host ?? '', secretValues)}
                      </span>{' '}
                      - {maskStringWithSecrets(b.message ?? '', secretValues)}
                    </div>
                    <div className="text-xs text-zinc-500 break-words">
                      {maskStringWithSecrets(b.url ?? '', secretValues)}
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

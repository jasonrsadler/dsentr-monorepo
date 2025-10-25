import { useCallback, useEffect, useMemo, useState } from 'react'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import {
  listWorkflows,
  type WorkflowRecord,
  setConcurrencyLimit,
  cancelAllRunsForWorkflow,
  purgeRuns,
  getEgressAllowlist,
  setEgressAllowlistApi
} from '@/lib/workflowApi'
import { normalizePlanTier } from '@/lib/planTiers'

const CONCURRENCY_RESTRICTION_MESSAGE =
  'Solo plan workflows run one job at a time. Upgrade in Settings → Plan to raise the concurrency limit.'

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
  }, [selected])
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
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [purgeDays, setPurgeDays] = useState('')
  const [egressText, setEgressText] = useState('')
  const [egressBusy, setEgressBusy] = useState(false)

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
        <h3 className="font-semibold mb-2">Egress Whitelist</h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
          One host or wildcard per line (e.g., api.github.com or *.mycorp.com).
          Global whitelist from server is also applied.
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
            {`Save Whitelist${adminOnlySuffix}`}
          </button>
        </div>
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
    </div>
  )
}

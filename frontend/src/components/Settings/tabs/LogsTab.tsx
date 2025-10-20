import { useCallback, useEffect, useMemo, useState } from 'react'
import JsonDialog from '@/components/UI/Dialog/JsonDialog'
import { useSecrets } from '@/contexts/SecretsContext'
import {
  getWorkflowLogs,
  listWorkflows,
  clearWorkflowLogs,
  deleteWorkflowLog,
  WorkflowLogEntry,
  WorkflowRecord,
  listRunsForWorkflow,
  getWorkflowRunStatus,
  listDeadLetters,
  requeueDeadLetter,
  clearDeadLetters,
  type DeadLetter,
  listEgressBlocks,
  clearEgressBlocks,
  type EgressBlockEvent
} from '@/lib/workflowApi'
import {
  flattenSecretValues,
  maskValueForPath,
  maskSecretsDeep,
  maskStringWithSecrets
} from '@/lib/secretMask'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'

type LogsTabKey = 'successful' | 'dead' | 'blocked' | 'history'

const TAB_CONFIG: { key: LogsTabKey; label: string }[] = [
  { key: 'successful', label: 'Successful Runs' },
  { key: 'dead', label: 'Dead-Letter Queue' },
  { key: 'blocked', label: 'Blocked Egress' },
  { key: 'history', label: 'Change History' }
]

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

export default function LogsTab() {
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const activeWorkspaceId = currentWorkspace?.workspace.id ?? null
  const workspaceRole = (currentWorkspace?.role ?? '').toLowerCase()
  const canAdministerEngine =
    workspaceRole === 'owner' || workspaceRole === 'admin'
  const adminOnlyTooltip =
    'Only workspace owners or admins can perform this action.'
  const adminOnlySuffix = canAdministerEngine ? '' : ' (owners/admins only)'
  const adminOnlyTitle = canAdministerEngine ? undefined : adminOnlyTooltip

  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [workflowId, setWorkflowId] = useState<string>('')
  const [activeTab, setActiveTab] = useState<LogsTabKey>('successful')
  const [logs, setLogs] = useState<WorkflowLogEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [workflowName, setWorkflowName] = useState<string>('')

  const SUCCESSFUL_RUNS_PER_PAGE = 20
  const [successfulRuns, setSuccessfulRuns] = useState<any[]>([])
  const [successfulPage, setSuccessfulPage] = useState(1)
  const [successfulHasMore, setSuccessfulHasMore] = useState(false)
  const [successfulLoading, setSuccessfulLoading] = useState(false)

  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([])
  const [dlBusyId, setDlBusyId] = useState<string | null>(null)

  const [egressBlocks, setEgressBlocks] = useState<EgressBlockEvent[]>([])
  const [egressLoading, setEgressLoading] = useState(false)

  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonTitle, setJsonTitle] = useState('')
  const [jsonBody, setJsonBody] = useState('')

  const { secrets } = useSecrets()
  const secretValues = useMemo(() => flattenSecretValues(secrets), [secrets])

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === workflowId) ?? null,
    [workflows, workflowId]
  )
  const displayWorkflowName = workflowName || selectedWorkflow?.name || ''

  useEffect(() => {
    listWorkflows(activeWorkspaceId)
      .then((ws) => {
        setWorkflows(ws)
        setWorkflowId((prev) => {
          if (prev && ws.some((w) => w.id === prev)) {
            return prev
          }
          return ws[0]?.id ?? ''
        })
      })
      .catch(() => {})
  }, [activeWorkspaceId])

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

  const refreshSuccessfulRuns = useCallback(
    async (page: number) => {
      if (!workflowId) {
        setSuccessfulRuns([])
        setSuccessfulHasMore(false)
        setSuccessfulPage(1)
        return
      }

      setSuccessfulLoading(true)
      try {
        const items = await listRunsForWorkflow(workflowId, {
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
    [workflowId]
  )

  const refreshDeadLetters = useCallback(async () => {
    if (!workflowId) {
      setDeadLetters([])
      return
    }
    try {
      const items = await listDeadLetters(workflowId, 1, 50)
      setDeadLetters(sanitizeDeadLetters(items))
    } catch {
      setDeadLetters([])
    }
  }, [workflowId, sanitizeDeadLetters])

  const refreshEgressBlocks = useCallback(async () => {
    if (!workflowId) {
      setEgressBlocks([])
      return
    }
    setEgressLoading(true)
    try {
      const items = await listEgressBlocks(workflowId, 1, 25)
      setEgressBlocks(sanitizeEgress(items))
    } catch {
      setEgressBlocks([])
    } finally {
      setEgressLoading(false)
    }
  }, [workflowId, sanitizeEgress])

  useEffect(() => {
    if (activeTab === 'successful') {
      refreshSuccessfulRuns(1)
    }
  }, [activeTab, workflowId, refreshSuccessfulRuns])

  useEffect(() => {
    if (activeTab === 'dead') {
      refreshDeadLetters()
    }
  }, [activeTab, workflowId, refreshDeadLetters])

  useEffect(() => {
    if (activeTab === 'blocked') {
      refreshEgressBlocks()
    }
  }, [activeTab, workflowId, refreshEgressBlocks])

  useEffect(() => {
    if (activeTab !== 'history') return
    if (!workflowId) {
      setLogs([])
      setWorkflowName('')
      return
    }
    setHistoryLoading(true)
    getWorkflowLogs(workflowId)
      .then(({ workflow, logs }) => {
        setLogs(logs)
        if (workflow?.name) {
          setWorkflowName(workflow.name)
        } else {
          setWorkflowName(selectedWorkflow?.name ?? '')
        }
      })
      .finally(() => setHistoryLoading(false))
  }, [activeTab, workflowId, selectedWorkflow])

  const handleRequeue = useCallback(
    async (id: string) => {
      if (!workflowId || !canAdministerEngine) return
      try {
        setDlBusyId(id)
        await requeueDeadLetter(workflowId, id)
        await refreshDeadLetters()
      } finally {
        setDlBusyId(null)
      }
    },
    [workflowId, canAdministerEngine, refreshDeadLetters]
  )

  const handleClearDeadLetters = useCallback(async () => {
    if (!workflowId || !canAdministerEngine) return
    try {
      await clearDeadLetters(workflowId)
      await refreshDeadLetters()
    } catch (error) {
      console.error((error as Error).message)
    }
  }, [workflowId, canAdministerEngine, refreshDeadLetters])

  const handleClearEgressBlocks = useCallback(async () => {
    if (!workflowId || !canAdministerEngine) return
    try {
      await clearEgressBlocks(workflowId)
      await refreshEgressBlocks()
    } catch (error) {
      console.error((error as Error).message)
    }
  }, [workflowId, canAdministerEngine, refreshEgressBlocks])

  const handleViewRunDetails = useCallback(
    async (runId: string) => {
      if (!workflowId) return
      try {
        const data = await getWorkflowRunStatus(workflowId, runId)
        const sanitized = maskSecretsDeep(
          {
            run: data.run,
            node_runs: data.node_runs
          },
          secretValues
        )
        setJsonTitle(`Run ${runId}`)
        setJsonBody(JSON.stringify(sanitized, null, 2))
        setJsonOpen(true)
      } catch (error) {
        console.error((error as Error).message)
      }
    },
    [workflowId, secretValues]
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm">Workflow</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
              disabled={workflows.length === 0}
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {displayWorkflowName && (
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              Viewing:{' '}
              <span className="font-medium">{displayWorkflowName}</span>
            </span>
          )}
        </div>
        {activeTab === 'history' && (
          <button
            className="text-sm underline"
            onClick={async () => {
              if (!workflowId) return
              await clearWorkflowLogs(workflowId)
              setLogs([])
            }}
            disabled={!workflowId}
          >
            Clear all
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1 rounded border text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'successful' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Successful Runs</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refreshSuccessfulRuns(successfulPage)}
                disabled={successfulLoading || !workflowId}
                className="text-sm underline disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Refresh
              </button>
              <div className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                <button
                  onClick={() =>
                    refreshSuccessfulRuns(Math.max(1, successfulPage - 1))
                  }
                  disabled={
                    successfulLoading || successfulPage === 1 || !workflowId
                  }
                  className="px-2 py-0.5 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="px-2 py-0.5 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
                  Page {successfulPage}
                </span>
                <button
                  onClick={() => refreshSuccessfulRuns(successfulPage + 1)}
                  disabled={
                    successfulLoading || !successfulHasMore || !workflowId
                  }
                  className="px-2 py-0.5 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          {!workflowId ? (
            <p className="text-sm text-zinc-500">
              Select a workflow to view successful runs.
            </p>
          ) : successfulLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : successfulRuns.length === 0 ? (
            <p className="text-sm text-zinc-500">No successful runs.</p>
          ) : (
            <div className="space-y-2">
              {successfulRuns.map((r: any) => {
                const started = r.started_at ? new Date(r.started_at) : null
                const finished = r.finished_at ? new Date(r.finished_at) : null
                const durSec =
                  started && finished
                    ? Math.max(
                        0,
                        (finished.getTime() - started.getTime()) / 1000
                      )
                    : null
                const triggeredBy = describeActorMetadata(r.triggered_by)
                const executedWith = describeCredentialMetadata(r.executed_with)
                return (
                  <div
                    key={r.id}
                    className="p-2 rounded border bg-white dark:bg-zinc-900 dark:border-zinc-700"
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
                          onClick={() => handleViewRunDetails(r.id)}
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
                            <span className="font-semibold">Triggered by:</span>{' '}
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

      {activeTab === 'dead' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Dead-Letter Queue</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={refreshDeadLetters}
                className="text-sm underline disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={!workflowId}
              >
                Refresh
              </button>
              <button
                onClick={handleClearDeadLetters}
                disabled={!workflowId || !canAdministerEngine}
                title={adminOnlyTitle}
                className="text-sm underline text-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {`Clear All${adminOnlySuffix}`}
              </button>
            </div>
          </div>
          {!workflowId ? (
            <p className="text-sm text-zinc-500">
              Select a workflow to view the dead-letter queue.
            </p>
          ) : deadLetters.length === 0 ? (
            <p className="text-sm text-zinc-500">No dead letters.</p>
          ) : (
            <div className="space-y-2">
              {deadLetters.map((d) => (
                <div
                  key={d.id}
                  className="p-2 rounded border bg-white dark:bg-zinc-900 dark:border-zinc-700"
                >
                  <div className="text-xs text-zinc-500">
                    {new Date(d.created_at).toLocaleString()} - run {d.run_id}
                  </div>
                  <div className="text-sm truncate" title={d.error ?? ''}>
                    {d.error}
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

      {activeTab === 'blocked' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Blocked Egress</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={refreshEgressBlocks}
                className="text-sm underline disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={!workflowId}
              >
                Refresh
              </button>
              <button
                onClick={handleClearEgressBlocks}
                disabled={!workflowId || !canAdministerEngine}
                title={adminOnlyTitle}
                className="text-sm underline text-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {`Clear All${adminOnlySuffix}`}
              </button>
            </div>
          </div>
          {!workflowId ? (
            <p className="text-sm text-zinc-500">
              Select a workflow to view blocked egress events.
            </p>
          ) : egressLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : egressBlocks.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No blocked requests recorded.
            </p>
          ) : (
            <div className="space-y-2">
              {egressBlocks.map((b) => (
                <div
                  key={b.id}
                  className="p-2 rounded border bg-white dark:bg-zinc-900 dark:border-zinc-700"
                >
                  <div className="text-xs text-zinc-500">
                    {new Date(b.created_at).toLocaleString()} - node {b.node_id}{' '}
                    - {b.rule}
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

      {activeTab === 'history' && (
        <div className="space-y-4">
          {!workflowId ? (
            <p className="text-sm text-zinc-500">
              Select a workflow to view change history.
            </p>
          ) : historyLoading ? (
            <p className="text-sm text-zinc-500">Loading logs…</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-zinc-500">No logs.</p>
          ) : (
            <div className="space-y-4">
              {logs.map((e) => (
                <div
                  key={e.id}
                  className="border border-zinc-200 dark:border-zinc-700 rounded p-3"
                >
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span>
                      {(() => {
                        const d = new Date(e.created_at as any)
                        return isNaN(d.getTime())
                          ? String(e.created_at)
                          : d.toLocaleString()
                      })()}
                    </span>
                    <button
                      className="text-xs underline"
                      onClick={async () => {
                        await deleteWorkflowLog(e.workflow_id, e.id)
                        setLogs((prev) => prev.filter((x) => x.id !== e.id))
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <ul className="text-xs space-y-1 max-h-48 overflow-auto">
                    {(Array.isArray(e.diffs) ? e.diffs : []).map(
                      (d: any, i: number) => {
                        const maskedFrom = maskValueForPath(
                          d.from,
                          typeof d.path === 'string' ? d.path : '',
                          secretValues
                        )
                        const maskedTo = maskValueForPath(
                          d.to,
                          typeof d.path === 'string' ? d.path : '',
                          secretValues
                        )
                        return (
                          <li key={i} className="font-mono">
                            {`${d.path}: ${JSON.stringify(maskedFrom)} → ${JSON.stringify(maskedTo)}`}
                          </li>
                        )
                      }
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
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

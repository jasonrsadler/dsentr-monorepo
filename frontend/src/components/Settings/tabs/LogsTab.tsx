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
  type EgressBlockEvent,
  type WorkflowRunRecord,
  type WorkflowNodeRunRecord
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
  { key: 'successful', label: 'Executed Runs' },
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

type ConnectionDescriptor = {
  scope: string | null
  id: string | null
  label?: string | null
  accountEmail?: string | null
  provider?: string | null
}

type SnapshotAnalysis = {
  nodes: Map<string, { type: string; subtype: string | null }>
  triggerSubtype: string | null
  connections: ConnectionDescriptor[]
}

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

const ACTION_SUBTYPE_LABELS: Record<string, string> = {
  email: 'Email',
  webhook: 'Webhook',
  messaging: 'Messaging',
  sheets: 'Sheets',
  http: 'HTTP',
  code: 'Custom Code'
}

const scopeLabel = (scope?: string | null): string | null => {
  if (!scope) return null
  const normalized = scope.toLowerCase()
  if (normalized === 'workspace') return 'Workspace connection'
  if (normalized === 'user' || normalized === 'personal')
    return 'Personal credentials'
  return titleCase(scope)
}

const inferNodeSubtype = (type: string, data: any): string | null => {
  if (!data || typeof data !== 'object') return null
  if (type === 'trigger') {
    const raw =
      typeof data.triggerType === 'string' ? data.triggerType.trim() : ''
    return raw ? titleCase(raw) : null
  }
  if (type === 'action') {
    const raw =
      typeof data.actionType === 'string' ? data.actionType.trim() : ''
    if (!raw) return null
    const normalized = raw.toLowerCase()
    return ACTION_SUBTYPE_LABELS[normalized] ?? titleCase(raw)
  }
  if (type === 'condition') return 'Condition'
  return null
}

const collectConnectionDescriptors = (value: any): ConnectionDescriptor[] => {
  const results: ConnectionDescriptor[] = []
  const visited = new WeakSet<object>()

  const visit = (input: any) => {
    if (!input || typeof input !== 'object') return
    if (visited.has(input as object)) return
    visited.add(input as object)
    if (Array.isArray(input)) {
      input.forEach(visit)
      return
    }

    const scopeCandidate = (() => {
      const scope =
        typeof (input as any).connectionScope === 'string'
          ? (input as any).connectionScope
          : typeof (input as any).oauthConnectionScope === 'string'
            ? (input as any).oauthConnectionScope
            : typeof (input as any).scope === 'string'
              ? (input as any).scope
              : null
      return scope ? scope.trim() : null
    })()

    const idCandidate = (() => {
      const rawId =
        typeof (input as any).connectionId === 'string'
          ? (input as any).connectionId
          : typeof (input as any).oauthConnectionId === 'string'
            ? (input as any).oauthConnectionId
            : null
      return rawId ? rawId.trim() : null
    })()

    const accountCandidate = (() => {
      const raw =
        typeof (input as any).accountEmail === 'string'
          ? (input as any).accountEmail
          : typeof (input as any).oauthAccountEmail === 'string'
            ? (input as any).oauthAccountEmail
            : null
      return raw ? raw.trim() : null
    })()

    if (scopeCandidate || idCandidate || accountCandidate) {
      const label = (() => {
        const rawLabel =
          typeof (input as any).label === 'string'
            ? (input as any).label
            : typeof (input as any).name === 'string'
              ? (input as any).name
              : typeof (input as any).connectionLabel === 'string'
                ? (input as any).connectionLabel
                : null
        return rawLabel ? rawLabel.trim() : null
      })()

      const provider = (() => {
        const rawProvider =
          typeof (input as any).provider === 'string'
            ? (input as any).provider
            : typeof (input as any).service === 'string'
              ? (input as any).service
              : null
        return rawProvider ? rawProvider.trim() : null
      })()

      results.push({
        scope: scopeCandidate ? scopeCandidate.toLowerCase() : null,
        id: idCandidate,
        accountEmail: accountCandidate,
        label,
        provider
      })
    }

    Object.values(input).forEach(visit)
  }

  visit(value)
  return results
}

const analyzeSnapshot = (snapshot: any): SnapshotAnalysis => {
  const nodes = new Map<string, { type: string; subtype: string | null }>()
  const connections: ConnectionDescriptor[] = []
  let triggerSubtype: string | null = null

  if (!snapshot || typeof snapshot !== 'object') {
    return { nodes, connections, triggerSubtype }
  }

  const nodeList = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  const connectionKeys = new Set<string>()

  nodeList.forEach((node: any) => {
    if (!node || typeof node !== 'object') return
    const id = typeof node.id === 'string' ? node.id : null
    if (!id) return
    const type = typeof node.type === 'string' ? node.type : ''
    const data = node.data ?? {}
    const subtype = inferNodeSubtype(type, data)
    if (type === 'trigger' && subtype && !triggerSubtype) {
      triggerSubtype = subtype
    }
    const nodeConnections = collectConnectionDescriptors(data)
    nodeConnections.forEach((descriptor) => {
      const key = [
        descriptor.scope ?? '',
        descriptor.id ?? '',
        descriptor.accountEmail ?? '',
        descriptor.label ?? '',
        descriptor.provider ?? ''
      ].join('::')
      if (!connectionKeys.has(key)) {
        connectionKeys.add(key)
        connections.push(descriptor)
      }
    })
    nodes.set(id, { type, subtype })
  })

  return { nodes, connections, triggerSubtype }
}

const formatTriggeredBy = (
  run: WorkflowRunRecord | null | undefined,
  analysis: SnapshotAnalysis
): string | null => {
  const parts: string[] = []
  if (analysis.triggerSubtype) {
    parts.push(`${analysis.triggerSubtype} trigger`)
  }
  const actor = describeActorMetadata(run?.triggered_by)
  if (actor) parts.push(actor)
  if (parts.length === 0) {
    const raw = run?.triggered_by
    if (typeof raw === 'string' && raw.trim()) {
      parts.push(raw.trim())
    }
  }
  return parts.length ? Array.from(new Set(parts)).join(' — ') : null
}

const formatConnectionDescriptor = (
  descriptor: ConnectionDescriptor
): string | null => {
  const parts: string[] = []
  if (descriptor.provider) parts.push(titleCase(descriptor.provider))
  if (descriptor.label) parts.push(descriptor.label)
  if (descriptor.accountEmail) parts.push(descriptor.accountEmail)
  const scope = scopeLabel(descriptor.scope)
  if (scope) parts.push(scope)
  if (descriptor.id) {
    const suffix =
      descriptor.id.length > 8 ? `${descriptor.id.slice(0, 8)}…` : descriptor.id
    parts.push(`#${suffix}`)
  }
  return parts.length ? Array.from(new Set(parts)).join(' · ') : null
}

const formatExecutedWith = (
  run: WorkflowRunRecord | null | undefined,
  analysis: SnapshotAnalysis
): string | null => {
  const formatted = analysis.connections
    .map((descriptor) => formatConnectionDescriptor(descriptor))
    .filter((value): value is string => Boolean(value))

  if (formatted.length) {
    return formatted.join('; ')
  }

  const fallback = describeCredentialMetadata(run?.executed_with)
  if (fallback) return fallback

  if (run?.executed_with && typeof run.executed_with === 'string') {
    const trimmed = run.executed_with.trim()
    return trimmed || null
  }

  return null
}

type RunDetailsSnapshot = {
  run: WorkflowRunRecord
  node_runs: WorkflowNodeRunRecord[]
}

const parseDateValue = (value?: string | null): Date | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const formatDateTime = (value?: string | null): string => {
  const date = parseDateValue(value)
  return date ? date.toLocaleString() : '—'
}

const formatStatusLabel = (status?: string | null): string => {
  if (!status) return 'Unknown'
  return status
    .toString()
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const formatDurationLabel = (
  startedAt?: string | null,
  finishedAt?: string | null
): string | null => {
  const start = parseDateValue(startedAt)
  const end = parseDateValue(finishedAt)
  if (!start || !end) return null
  const diff = Math.max(0, end.getTime() - start.getTime())
  if (!Number.isFinite(diff)) return null
  if (diff < 1000) {
    return `${Math.round(diff)}ms`
  }
  const seconds = diff / 1000
  return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(2)}s`
}

const describePayload = (value: any): string => {
  if (value === null || value === undefined) return 'No data'
  if (Array.isArray(value)) {
    return value.length
      ? `${value.length} item${value.length === 1 ? '' : 's'}`
      : 'Empty list'
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    return keys.length ? `Fields: ${keys.join(', ')}` : 'Empty object'
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 120
      ? `${trimmed.slice(0, 117)}…`
      : trimmed || 'Empty string'
  }
  return String(value)
}

const hasStructuredPayload = (value: any): boolean =>
  !!value && typeof value === 'object'

const getStatusBadgeTone = (status: string): string => {
  switch (status) {
    case 'succeeded':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'
    case 'running':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'
    case 'queued':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
    case 'skipped':
      return 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-200'
    case 'canceled':
      return 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-200'
    default:
      return 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-200'
  }
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
  const [successfulRuns, setSuccessfulRuns] = useState<WorkflowRunRecord[]>([])
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
  const [runDetails, setRunDetails] = useState<RunDetailsSnapshot | null>(null)

  const { secrets } = useSecrets()
  const secretValues = useMemo(() => flattenSecretValues(secrets), [secrets])

  const successfulRunSummaries = useMemo(() => {
    const summaries = new Map<
      string,
      { triggeredBy: string | null; executedWith: string | null }
    >()
    successfulRuns.forEach((run) => {
      if (!run || !run.id) return
      const analysis = analyzeSnapshot(run.snapshot)
      summaries.set(run.id, {
        triggeredBy: formatTriggeredBy(run, analysis),
        executedWith: formatExecutedWith(run, analysis)
      })
    })
    return summaries
  }, [successfulRuns])

  const runSnapshotAnalysis = useMemo(
    () => analyzeSnapshot(runDetails?.run.snapshot),
    [runDetails]
  )

  const runTriggeredBySummary = useMemo(
    () => formatTriggeredBy(runDetails?.run, runSnapshotAnalysis),
    [runDetails, runSnapshotAnalysis]
  )

  const runExecutedWithSummary = useMemo(
    () => formatExecutedWith(runDetails?.run, runSnapshotAnalysis),
    [runDetails, runSnapshotAnalysis]
  )

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
        ) as RunDetailsSnapshot
        const normalized: RunDetailsSnapshot = {
          run: sanitized.run,
          node_runs: Array.isArray(sanitized.node_runs)
            ? sanitized.node_runs
            : []
        }
        setRunDetails(normalized)
        setJsonTitle(`Run ${runId}`)
        setJsonBody(JSON.stringify(normalized, null, 2))
        setJsonOpen(true)
      } catch (error) {
        console.error((error as Error).message)
      }
    },
    [workflowId, secretValues]
  )

  const sortedNodeRuns = useMemo(() => {
    if (!runDetails) return []
    const runs = [...runDetails.node_runs]
    const toTimestamp = (node: WorkflowNodeRunRecord): number => {
      const start = parseDateValue(node.started_at)?.getTime()
      if (typeof start === 'number') return start
      const created = parseDateValue(node.created_at)?.getTime()
      if (typeof created === 'number') return created
      return Number.MAX_SAFE_INTEGER
    }
    return runs.sort((a, b) => toTimestamp(a) - toTimestamp(b))
  }, [runDetails])

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
            <h3 className="font-semibold">Executed Runs</h3>
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
              Select a workflow to view executed runs.
            </p>
          ) : successfulLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : successfulRuns.length === 0 ? (
            <p className="text-sm text-zinc-500">No executed runs recorded.</p>
          ) : (
            <div className="space-y-2">
              {successfulRuns.map((r) => {
                const started = r.started_at ? new Date(r.started_at) : null
                const finished = r.finished_at ? new Date(r.finished_at) : null
                const durSec =
                  started && finished
                    ? Math.max(
                        0,
                        (finished.getTime() - started.getTime()) / 1000
                      )
                    : null
                const summary = successfulRunSummaries.get(r.id)
                const triggeredBy = summary?.triggeredBy
                const executedWith = summary?.executedWith
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
        onClose={() => {
          setJsonOpen(false)
          setRunDetails(null)
        }}
        content={
          runDetails ? (
            <div className="space-y-6">
              <section className="space-y-2">
                <h3 className="font-semibold text-base">Run Summary</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <dt className="uppercase text-[11px] tracking-wide text-zinc-500 dark:text-zinc-400">
                      Status
                    </dt>
                    <dd className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeTone(
                          runDetails.run.status
                        )}`}
                      >
                        {formatStatusLabel(runDetails.run.status)}
                      </span>
                      {formatDurationLabel(
                        runDetails.run.started_at,
                        runDetails.run.finished_at
                      ) && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatDurationLabel(
                            runDetails.run.started_at,
                            runDetails.run.finished_at
                          )}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="uppercase text-[11px] tracking-wide text-zinc-500 dark:text-zinc-400">
                      Started
                    </dt>
                    <dd>{formatDateTime(runDetails.run.started_at)}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="uppercase text-[11px] tracking-wide text-zinc-500 dark:text-zinc-400">
                      Finished
                    </dt>
                    <dd>{formatDateTime(runDetails.run.finished_at)}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="uppercase text-[11px] tracking-wide text-zinc-500 dark:text-zinc-400">
                      Triggered By
                    </dt>
                    <dd>{runTriggeredBySummary || '—'}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="uppercase text-[11px] tracking-wide text-zinc-500 dark:text-zinc-400">
                      Executed With
                    </dt>
                    <dd>{runExecutedWithSummary || '—'}</dd>
                  </div>
                  {runDetails.run.error && (
                    <div className="sm:col-span-2 space-y-1">
                      <dt className="uppercase text-[11px] tracking-wide text-red-600 dark:text-red-400">
                        Error
                      </dt>
                      <dd className="font-mono text-xs text-red-600 dark:text-red-400 break-words">
                        {runDetails.run.error}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold text-base">Execution Flow</h3>
                {sortedNodeRuns.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No node executions recorded for this run.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {sortedNodeRuns.map((node, index) => {
                      const duration = formatDurationLabel(
                        node.started_at,
                        node.finished_at
                      )
                      const inputsSummary = describePayload(node.inputs)
                      const outputsSummary = describePayload(node.outputs)
                      const nodeMeta = runSnapshotAnalysis.nodes.get(
                        node.node_id
                      )
                      const baseType = nodeMeta?.type || node.node_type || ''
                      const nodeTypeLabel = baseType
                        ? formatStatusLabel(baseType)
                        : `Node ${node.node_id}`
                      const nodeSubtypeLabel = nodeMeta?.subtype || null
                      const nodeTypeDisplay = nodeSubtypeLabel
                        ? `${nodeTypeLabel} · ${nodeSubtypeLabel}`
                        : nodeTypeLabel
                      return (
                        <li
                          key={node.id}
                          className="rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-col">
                              <span className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                                Step {index + 1}
                              </span>
                              <span className="font-medium text-sm">
                                {node.name?.trim() || `Node ${node.node_id}`}
                              </span>
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {nodeTypeDisplay}
                              </span>
                            </div>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeTone(
                                node.status
                              )}`}
                            >
                              {formatStatusLabel(node.status)}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                            <div>
                              <div className="uppercase text-[10px] tracking-wide text-zinc-500 dark:text-zinc-400">
                                Started
                              </div>
                              <div>{formatDateTime(node.started_at)}</div>
                            </div>
                            <div>
                              <div className="uppercase text-[10px] tracking-wide text-zinc-500 dark:text-zinc-400">
                                Finished
                              </div>
                              <div>{formatDateTime(node.finished_at)}</div>
                            </div>
                            {duration && (
                              <div>
                                <div className="uppercase text-[10px] tracking-wide text-zinc-500 dark:text-zinc-400">
                                  Duration
                                </div>
                                <div>{duration}</div>
                              </div>
                            )}
                            <div>
                              <div className="uppercase text-[10px] tracking-wide text-zinc-500 dark:text-zinc-400">
                                Run ID
                              </div>
                              <div className="font-mono break-all">
                                {node.id}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 space-y-2 text-xs text-zinc-600 dark:text-zinc-300">
                            <div>
                              <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                                Inputs:
                              </span>{' '}
                              {inputsSummary}
                              {hasStructuredPayload(node.inputs) && (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-[11px] underline">
                                    View input details
                                  </summary>
                                  <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-zinc-100 dark:bg-zinc-800 p-2 text-[11px] font-mono">
                                    {JSON.stringify(node.inputs, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                            <div>
                              <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                                Outputs:
                              </span>{' '}
                              {outputsSummary}
                              {hasStructuredPayload(node.outputs) && (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-[11px] underline">
                                    View output details
                                  </summary>
                                  <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-zinc-100 dark:bg-zinc-800 p-2 text-[11px] font-mono">
                                    {JSON.stringify(node.outputs, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                            {node.error && (
                              <div>
                                <span className="font-semibold text-red-600 dark:text-red-400">
                                  Error:
                                </span>{' '}
                                <span className="font-mono break-words">
                                  {node.error}
                                </span>
                              </div>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No run details loaded.</p>
          )
        }
      />
    </div>
  )
}

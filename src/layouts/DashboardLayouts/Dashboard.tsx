import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '@/lib/config'
import '@xyflow/react/dist/style.css'
import WorkflowToolbar from './Toolbar'
import FlowCanvas from './FlowCanvas'
import ActionIcon from '@/assets/svg-components/ActionIcon'
import ConditionIcon from '@/assets/svg-components/ConditionIcon'
import { ReactFlowProvider } from '@xyflow/react'
import { useWorkflowLogs } from '@/stores/workflowLogs'
import {
  listWorkflows,
  getWorkflow,
  createWorkflow as createWorkflowApi,
  updateWorkflow as updateWorkflowApi,
  WorkflowRecord,
  startWorkflowRun,
  getWorkflowRunStatus,
  cancelRun,
  listActiveRuns,
  type WorkflowRunRecord,
  type WorkflowNodeRunRecord,
} from '@/lib/workflowApi'

const TriggerIcon = () => (
  <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v20M2 12h20" />
  </svg>
)

const createEmptyGraph = () => ({ nodes: [] as any[], edges: [] as any[] })
function sortById<T extends { id: string }>(arr: T[]): T[] { return [...arr].sort((a, b) => a.id.localeCompare(b.id)) }
function sanitizeData(data: any) {
  if (!data || typeof data !== 'object') return data
  const { dirty, wfEpoch, ...rest } = data as any
  return rest
}

const serializeSnapshot = (
  meta: { name: string; description: string | null },
  graph: { nodes: any[]; edges: any[] }
) => JSON.stringify({ meta, graph })

function normalizeEdgeForPayload(e: any) {
  const label = (e as any).label ?? null
  const animated = Boolean((e as any).animated)
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type,
    data: e.data,
    label,
    animated,
  }
}

function flatten(obj: any, prefix = ''): Record<string, any> {
  const out: Record<string, any> = {}
  if (obj === null || typeof obj !== 'object') {
    out[prefix || ''] = obj
    return out
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      const p = prefix ? `${prefix}[${i}]` : `[${i}]`
      Object.assign(out, flatten(v, p))
    })
    return out
  }
  for (const k of Object.keys(obj).sort()) {
    const p = prefix ? `${prefix}.${k}` : k
    Object.assign(out, flatten(obj[k], p))
  }
  return out
}

function logSnapshotDiff(where: string, baselineStr: string, currentStr: string) {
  try {
    if (baselineStr === currentStr) return
    const a = JSON.parse(baselineStr)
    const b = JSON.parse(currentStr)
    const af = flatten(a)
    const bf = flatten(b)
    const keys = new Set<string>([...Object.keys(af), ...Object.keys(bf)])
    const diffs: string[] = []
    for (const k of Array.from(keys).sort()) {
      if (af[k] !== bf[k]) {
        diffs.push(`${k}: ${JSON.stringify(af[k])} -> ${JSON.stringify(bf[k])}`)
        if (diffs.length >= 25) break
      }
    }
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[workflow-dirty][${where}] snapshot diff (${diffs.length} shown)`) 
    // eslint-disable-next-line no-console
    diffs.forEach(d => console.log(d))
    // eslint-disable-next-line no-console
    console.groupEnd()
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[workflow-dirty] diff failed')
  }
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if ((a as any[]).length !== (b as any[]).length) return false
    for (let i = 0; i < (a as any[]).length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  if (ak.length !== bk.length) return false
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false
    if (!deepEqual(a[ak[i]], b[bk[i]])) return false
  }
  return true
}

export default function Dashboard() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null)
  const [workflowData, setWorkflowData] = useState(createEmptyGraph)
  const [workflowDirty, setWorkflowDirty] = useState(false)
  const [loadingWorkflows, setLoadingWorkflows] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSavingRef = useRef(false)
  // Settings moved to DashboardLayout header
  const addLog = useWorkflowLogs((s) => s.add)
  const saveRef = useRef<{
    saveAllNodes?: () => any[]
    getEdges?: () => any[]
    setNodesFromToolbar?: (updatedNodes: any[]) => void
    loadGraph?: (graph: { nodes: any[]; edges: any[] }) => void
  } | null>(null)
  const lastSavedSnapshotRef = useRef<string>(
    serializeSnapshot({ name: '', description: null }, createEmptyGraph())
  )
  const pendingSnapshotRef = useRef<string | null>(null)
  const latestGraphRef = useRef<{ nodes: any[]; edges: any[] }>(createEmptyGraph())

  // Run state
  const [runOverlayOpen, setRunOverlayOpen] = useState(false)
  const [activeRun, setActiveRun] = useState<WorkflowRunRecord | null>(null)
  const [nodeRuns, setNodeRuns] = useState<WorkflowNodeRunRecord[]>([])
  const pollTimerRef = useRef<any>(null)
  const currentPollRunIdRef = useRef<string | null>(null)
  const overlayWatchTimerRef = useRef<any>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [runToast, setRunToast] = useState<string | null>(null)
  // Global run status aggregator for toolbar (across all workflows)
  const [globalRunStatus, setGlobalRunStatus] = useState<'idle' | 'queued' | 'running'>('idle')
  const globalRunsTimerRef = useRef<any>(null)
  // Runs tab state
  const [activePane, setActivePane] = useState<'designer' | 'runs'>('designer')
  const [runsScope, setRunsScope] = useState<'current' | 'all'>('current')
  const [runQueue, setRunQueue] = useState<WorkflowRunRecord[]>([])
  const runQueueTimerRef = useRef<any>(null)
  // Stable execution state identities to avoid unnecessary re-renders
  const runningIds = useMemo(
    () => new Set(nodeRuns.filter(n => n.status === 'running').map(n => n.node_id)),
    [nodeRuns]
  )
  const succeededIds = useMemo(
    () => new Set(nodeRuns.filter(n => n.status === 'succeeded').map(n => n.node_id)),
    [nodeRuns]
  )
  const failedIds = useMemo(
    () => new Set(nodeRuns.filter(n => n.status === 'failed').map(n => n.node_id)),
    [nodeRuns]
  )

  const normalizeWorkflowData = useCallback((data: any) => {
    if (data && typeof data === 'object') {
      const rawNodes = Array.isArray((data as any).nodes) ? (data as any).nodes : []
      const rawEdges = Array.isArray((data as any).edges) ? (data as any).edges : []
      // Deep-clone to avoid accidental shared references across workflows
      const nodes = rawNodes.map((n: any) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data ? JSON.parse(JSON.stringify(n.data)) : undefined
      }))
      const edges = rawEdges.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type,
        data: e.data ? JSON.parse(JSON.stringify(e.data)) : undefined,
        label: e.label ?? null,
        animated: Boolean((e as any).animated)
      }))
      return { nodes, edges }
    }

    return createEmptyGraph()
  }, [])

  const currentWorkflow = useMemo(
    () => workflows.find(workflow => workflow.id === currentWorkflowId) ?? null,
    [workflows, currentWorkflowId]
  )

  const currentMeta = useMemo(
    () => ({
      name: currentWorkflow?.name ?? '',
      description: currentWorkflow?.description ?? null
    }),
    [currentWorkflow?.name, currentWorkflow?.description]
  )

  const workflowOptions = useMemo(
    () => workflows.map(workflow => ({ id: workflow.id, name: workflow.name })),
    [workflows]
  )

  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        setLoadingWorkflows(true)
        setError(null)
        const data = await listWorkflows()
        setWorkflows(data)

        if (data.length > 0) {
          const [first] = data
          const normalized = normalizeWorkflowData(first.data)
          setCurrentWorkflowId(first.id)
          setWorkflowData(normalized)
          latestGraphRef.current = normalized
          lastSavedSnapshotRef.current = serializeSnapshot(
            { name: first.name, description: first.description ?? null },
            normalized
          )
        } else {
          const empty = createEmptyGraph()
          setCurrentWorkflowId(null)
          setWorkflowData(empty)
          latestGraphRef.current = empty
          lastSavedSnapshotRef.current = serializeSnapshot({ name: '', description: null }, empty)
        }

        pendingSnapshotRef.current = null
        setWorkflowDirty(false)
      } catch (err) {
        console.error('Failed to load workflows', err)
        setError('Failed to load workflows.')
        setWorkflows([])
        setCurrentWorkflowId(null)
        const empty = createEmptyGraph()
        setWorkflowData(empty)
        latestGraphRef.current = empty
        lastSavedSnapshotRef.current = serializeSnapshot({ name: '', description: null }, empty)
        pendingSnapshotRef.current = null
        setWorkflowDirty(false)
      } finally {
        setLoadingWorkflows(false)
      }
    }

    fetchWorkflows()
  }, [normalizeWorkflowData])

  const markWorkflowDirty = useCallback(() => {
    setError(null)
  }, [])

  const selectWorkflow = useCallback(
    (id: string) => {
      if (id === currentWorkflowId) return

      // If current workflow has unsaved changes, prompt before switching
      if (workflowDirty) {
        setPendingSwitchId(id)
        setShowSwitchConfirm(true)
        return
      }

      doSelectWorkflow(id)
    },
    [currentWorkflowId, workflows, normalizeWorkflowData, workflowDirty]
  )

  // Internal function to apply the actual switch logic
  const doSelectWorkflow = useCallback((id: string) => {
    const nextWorkflow = workflows.find(workflow => workflow.id === id)
    setCurrentWorkflowId(id)
    setWorkflowDirty(false)
    setError(null)

    // Always try to fetch fresh data for the selected workflow to avoid shared references/stale state
    ;(async () => {
      try {
        const fresh = await getWorkflow(id)
        // Update list cache with fresh record
        setWorkflows(prev => prev.map(w => (w.id === fresh.id ? fresh : w)))
        const normalized = normalizeWorkflowData(fresh.data)
        setWorkflowData(normalized)
        latestGraphRef.current = normalized
        lastSavedSnapshotRef.current = serializeSnapshot(
          { name: fresh.name, description: fresh.description ?? null },
          normalized
        )
      } catch (e) {
        // Fallback to local cache if fetch fails
        if (nextWorkflow) {
          const normalized = normalizeWorkflowData(nextWorkflow.data)
          setWorkflowData(normalized)
          latestGraphRef.current = normalized
          lastSavedSnapshotRef.current = serializeSnapshot(
            { name: nextWorkflow.name, description: nextWorkflow.description ?? null },
            normalized
          )
        } else {
          const empty = createEmptyGraph()
          setWorkflowData(empty)
          latestGraphRef.current = empty
          lastSavedSnapshotRef.current = serializeSnapshot({ name: '', description: null }, empty)
        }
      } finally {
        pendingSnapshotRef.current = null
      }
    })()
  }, [workflows, normalizeWorkflowData])

  // Confirm-to-switch dialog state
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false)
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null)

  // After save completes successfully (dirty=false and not saving), perform pending switch
  useEffect(() => {
    if (showSwitchConfirm && pendingSwitchId && !isSaving && !workflowDirty) {
      const target = pendingSwitchId
      setShowSwitchConfirm(false)
      setPendingSwitchId(null)
      doSelectWorkflow(target)
    }
  }, [showSwitchConfirm, pendingSwitchId, isSaving, workflowDirty, doSelectWorkflow])

  // Warn on browser tab close/refresh when there are unsaved changes
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (workflowDirty && !isSaving) {
        e.preventDefault()
        // Some browsers require returnValue to be set
        e.returnValue = ''
        return ''
      }
      return undefined
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [workflowDirty, isSaving])

  const renameWorkflow = useCallback(
    (id: string, newName: string) => {
      setWorkflows(prev =>
        prev.map(workflow => (workflow.id === id ? { ...workflow, name: newName } : workflow))
      )
      if (id === currentWorkflowId) {
        setWorkflowDirty(true)
      }
    },
    [currentWorkflowId]
  )

  const handleNewWorkflow = useCallback(async () => {
    // Guard against rapid double-clicks while a create is in-flight
    if (isSavingRef.current || isSaving) return
    try {
      isSavingRef.current = true
      setIsSaving(true)
      setError(null)

      const base = 'New Workflow'
      // Always enforce unique, case-insensitive names
      const existing = new Set(workflows.map(w => (w.name || '').toLowerCase()))
      let unique = base
      let i = 1
      while (existing.has(unique.toLowerCase())) {
        i += 1
        unique = `${base} (${i})`
      }

      const payload = {
        name: unique,
        description: null,
        data: createEmptyGraph()
      }

      const created = await createWorkflowApi(payload)
      setWorkflows(prev => [created, ...prev])
      setCurrentWorkflowId(created.id)

      const normalized = normalizeWorkflowData(created.data ?? payload.data)
      setWorkflowData(normalized)
      latestGraphRef.current = normalized
      lastSavedSnapshotRef.current = serializeSnapshot(
        { name: created.name ?? payload.name, description: created.description ?? null },
        normalized
      )
      pendingSnapshotRef.current = null
      setWorkflowDirty(false)
    } catch (err) {
      console.error('Failed to create workflow', err)
      setError('Failed to create workflow.')
      window.alert('Failed to create workflow. Please try again.')
    } finally {
      setIsSaving(false)
      isSavingRef.current = false
    }
  }, [normalizeWorkflowData, isSaving, workflows])

  const handleGraphChange = useCallback(
    (graph: { nodes: any[]; edges: any[] }) => {
      if (isSavingRef.current) {
        latestGraphRef.current = graph
        return
      }
      latestGraphRef.current = graph
      const snapshot = serializeSnapshot(currentMeta, graph)
      const baseline = pendingSnapshotRef.current ?? lastSavedSnapshotRef.current
      let dirty = true
      try {
        const baselineObj = JSON.parse(baseline)
        const currentObj = JSON.parse(snapshot)
        dirty = !deepEqual(baselineObj, currentObj)
      } catch {
        dirty = snapshot !== baseline
      }
      if (dirty) {
        logSnapshotDiff('graphChange', baseline, snapshot)
      }
      setWorkflowDirty(dirty)
      setIsGraphEmpty((graph?.nodes?.length ?? 0) === 0 && (graph?.edges?.length ?? 0) === 0)
    },
    [currentMeta]
  )

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    // Ignore any in-flight responses for previous run ids
    currentPollRunIdRef.current = null
  }, [])

  const pollBackoffRef = useRef<number>(0)
  const pollRun = useCallback(async (workflowId: string, runId: string) => {
    // Drop stale polls (e.g., after switching to a different run)
    if (currentPollRunIdRef.current !== runId) return
    try {
      const { run, node_runs } = await getWorkflowRunStatus(workflowId, runId)
      // Ignore if this response is for an outdated runId
      if (currentPollRunIdRef.current !== runId) return
      setActiveRun(run)
      setNodeRuns(node_runs)
      // reset backoff on success
      pollBackoffRef.current = 0
      if (run.status === 'queued' || run.status === 'running') {
        pollTimerRef.current = setTimeout(() => pollRun(workflowId, runId), 1000)
      } else {
        // terminal: clear timer
        stopPolling()
        // If overlay is open for this workflow, watch for next running or queued run
        if (runOverlayOpen && currentWorkflow && currentWorkflow.id === workflowId) {
          if (overlayWatchTimerRef.current) {
            clearTimeout(overlayWatchTimerRef.current)
            overlayWatchTimerRef.current = null
          }
          const watchTick = async () => {
            try {
              const runs = await listActiveRuns(workflowId)
              const next = runs.find(r => r.status === 'running') || runs.find(r => r.status === 'queued')
              if (next) {
                setActiveRun(next)
                setNodeRuns([])
                currentPollRunIdRef.current = next.id
                pollRun(workflowId, next.id)
                overlayWatchTimerRef.current = null
                return
              }
            } catch {}
            if (runOverlayOpen && currentWorkflow && currentWorkflow.id === workflowId) {
              overlayWatchTimerRef.current = setTimeout(watchTick, 1000)
            }
          }
          overlayWatchTimerRef.current = setTimeout(watchTick, 1000)
        }
      }
    } catch (e) {
      console.error('Polling run failed', e)
      // Back off and retry instead of stopping, in case of transient 429/Network errors
      const attempt = pollBackoffRef.current || 0
      const delay = Math.min(5000, 1000 * Math.pow(2, Math.min(3, attempt)))
      pollBackoffRef.current = attempt + 1
      // Only reschedule if this runId is still the intended one
      if (currentPollRunIdRef.current === runId) {
        pollTimerRef.current = setTimeout(() => pollRun(workflowId, runId), delay)
      }
    }
  }, [stopPolling, runOverlayOpen, currentWorkflow])

  const fetchRunQueue = useCallback(async () => {
    try {
      const wid = runsScope === 'current' ? currentWorkflow?.id : undefined
      const runs = await listActiveRuns(wid)
      setRunQueue(runs)
    } catch (e) {
      console.error('Failed to fetch runs', e)
    }
  }, [runsScope, currentWorkflow?.id])

  // Ensure overlay shows only the active run for the currently selected workflow
  // Now: no REST polling here; discovery is done via SSE in the effect below.
  const ensureOverlayRunForSelected = useCallback(async () => {
    if (!currentWorkflow) {
      setActiveRun(null)
      setNodeRuns([])
      return
    }
    const isActiveForSelected =
      activeRun && activeRun.workflow_id === currentWorkflow.id &&
      (activeRun.status === 'running' || activeRun.status === 'queued')
    if (isActiveForSelected) return
    // Clear and let SSE discovery latch onto the next run
    stopPolling()
    setActiveRun(null)
    setNodeRuns([])
  }, [currentWorkflow, activeRun, stopPolling])

  const handleToggleRunOverlay = useCallback(() => {
    if (runOverlayOpen) {
      if (overlayWatchTimerRef.current) {
        clearTimeout(overlayWatchTimerRef.current)
        overlayWatchTimerRef.current = null
      }
      setRunOverlayOpen(false)
      return
    }
    setRunOverlayOpen(true)
    try { window.dispatchEvent(new CustomEvent('dsentr-resume-global-poll')) } catch {}
    // Kick off selection of the appropriate run for this workflow
    ensureOverlayRunForSelected()
  }, [runOverlayOpen, ensureOverlayRunForSelected])

  // Keep overlay latched to the selected workflow's next running/queued run via SSE, with REST fallback
  useEffect(() => {
    if (!runOverlayOpen || !currentWorkflow || activeRun) return

    const base = (API_BASE_URL || '').replace(/\/$/, '')
    const url = `${base}/api/workflows/${currentWorkflow.id}/runs/events-stream`
    let es: EventSource | null = null
    let fallbackTimer: any = null
    let backoff = 1500

    const pickFrom = (runs: any[]) => {
      const candidate = runs.find(r => r.status === 'running') || runs.find(r => r.status === 'queued')
      if (candidate) {
        setActiveRun(candidate)
        setNodeRuns([])
        try { es?.close() } catch {}
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
        return true
      }
      return false
    }

    const startFallback = () => {
      const doFetch = async () => {
        try {
          const runs = await listActiveRuns(currentWorkflow.id)
          if (pickFrom(runs)) return
        } catch {}
        // schedule next attempt with capped backoff
        backoff = Math.min(5000, backoff * 2)
        fallbackTimer = setTimeout(doFetch, backoff)
      }
      doFetch()
    }

    try { es = new EventSource(url, { withCredentials: true } as EventSourceInit) } catch { es = null }
    if (!es) { startFallback(); return }

    const onRuns = (e: MessageEvent) => { try { const runs = JSON.parse(e.data); pickFrom(runs) } catch {} }
    const onError = () => { try { es?.close() } catch {}; if (!fallbackTimer) startFallback() }
    es.addEventListener('runs', onRuns as any)
    es.onerror = onError

    return () => {
      try { es?.close() } catch {}
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
    }
  }, [runOverlayOpen, currentWorkflow?.id, activeRun])

  // Global runs SSE to drive toolbar status
  useEffect(() => {
    const base = (API_BASE_URL || '').replace(/\/$/, '')
    const url = `${base}/api/workflows/runs/events`
    let es: EventSource | null = null
    try {
      es = new EventSource(url, { withCredentials: true } as EventSourceInit)
    } catch {
      es = null
    }
    if (!es) return
    const onStatus = (e: MessageEvent) => {
      try {
        const s = JSON.parse(e.data)
        if (s.has_running) setGlobalRunStatus('running')
        else if (s.has_queued) setGlobalRunStatus('queued')
        else setGlobalRunStatus('idle')
      } catch {}
    }
    es.addEventListener('status', onStatus as any)
    es.onerror = () => { try { es?.close() } catch {} }
    return () => { try { es?.close() } catch {} }
  }, [])
  const toolbarRunStatus = useMemo(() => {
    if (activeRun?.status === 'running') return 'running'
    if (globalRunStatus === 'running') return 'running'
    if (globalRunStatus === 'queued') return 'queued'
    if (activeRun?.status === 'queued' && globalRunStatus !== 'running') return 'queued'
    return 'idle'
  }, [activeRun?.status, globalRunStatus])

  // Runs tab: consume SSE of active runs for the selected workflow
  useEffect(() => {
    if (activePane !== 'runs' || !currentWorkflow) return
    const base = (API_BASE_URL || '').replace(/\/$/, '')
    const url = `${base}/api/workflows/${currentWorkflow.id}/runs/events-stream`
    let es: EventSource | null = null
    try { es = new EventSource(url, { withCredentials: true } as EventSourceInit) } catch { es = null }
    if (!es) return
    const onRuns = (e: MessageEvent) => { try { setRunQueue(JSON.parse(e.data)) } catch {} }
    es.addEventListener('runs', onRuns as any)
    es.onerror = () => { try { es?.close() } catch {} }
    return () => { try { es?.close() } catch {} }
  }, [activePane, currentWorkflow?.id])

  const handleRunWorkflow = useCallback(async () => {
    if (!currentWorkflow) return
    if (workflowDirty) {
      window.alert('Please save the workflow before running.')
      return
    }
    try {
      setActiveRun(null)
      setNodeRuns([])
      const run = await startWorkflowRun(currentWorkflow.id)
      setActiveRun(run)
      currentPollRunIdRef.current = run.id
      pollRun(currentWorkflow.id, run.id)
      try { window.dispatchEvent(new CustomEvent('dsentr-resume-global-poll')) } catch {}
    } catch (e: any) {
      console.error('Failed to start run', e)
      setError(e?.message || 'Failed to start run')
    }
  }, [currentWorkflow, workflowDirty, pollRun])

  // Overlay: subscribe to SSE for active run to reduce client work
  useEffect(() => {
    if (!runOverlayOpen || !currentWorkflow || !activeRun) return
    // Stop any REST polling for this run
    stopPolling()

    const base = (API_BASE_URL || '').replace(/\/$/, '')
    const url = `${base}/api/workflows/${currentWorkflow.id}/runs/${activeRun.id}/events`
    let es: EventSource | null = null
    try {
      es = new EventSource(url, { withCredentials: true } as EventSourceInit)
    } catch {
      es = null
    }
    if (!es) return

    const onRun = (e: MessageEvent) => {
      try {
        const run = JSON.parse(e.data)
        setActiveRun(run)
        if (run.status !== 'queued' && run.status !== 'running') {
          es?.close()
        }
      } catch {}
    }
    const onNodes = (e: MessageEvent) => {
      try { setNodeRuns(JSON.parse(e.data)) } catch {}
    }
    const onError = () => {
      // Allow adaptive global poll to wake if needed
      try { window.dispatchEvent(new CustomEvent('dsentr-resume-global-poll')) } catch {}
      es?.close()
    }

    es.addEventListener('run', onRun as any)
    es.addEventListener('node_runs', onNodes as any)
    es.onerror = onError

    return () => { try { es?.close() } catch {} }
  }, [runOverlayOpen, currentWorkflow?.id, activeRun?.id, stopPolling])

  useEffect(() => {
    // Only recompute dirty state on meta changes while editing in designer.
    // Avoids marking dirty when switching workflows from the Runs tab.
    if (activePane !== 'designer') return
    handleGraphChange(latestGraphRef.current)
  }, [currentMeta, handleGraphChange, activePane])

  const handleSave = useCallback(async () => {
    if (!saveRef.current || !currentWorkflow || isSaving) {
      return
    }

    const nodesData = saveRef.current.saveAllNodes?.() || []
    const edgesData = saveRef.current.getEdges?.() || []

    const cleanNodes = sortById(
      nodesData.map((n: any) => ({ id: n.id, type: n.type, position: n.position, data: sanitizeData(n.data) }))
    )
    const cleanEdges = sortById(edgesData.map(normalizeEdgeForPayload))
    const payloadGraph = {
      nodes: cleanNodes,
      edges: cleanEdges
    }

    const pendingSnapshot = serializeSnapshot(
      { name: currentWorkflow.name, description: currentWorkflow.description ?? null },
      payloadGraph
    )

    pendingSnapshotRef.current = pendingSnapshot
    setWorkflowDirty(false)
    isSavingRef.current = true
    setIsSaving(true)
    setError(null)

    saveRef.current.setNodesFromToolbar?.(nodesData)
    try {
      const updated = await updateWorkflowApi(currentWorkflow.id, {
        name: currentWorkflow.name,
        description: currentWorkflow.description ?? null,
        data: payloadGraph
      })

      setWorkflows(prev =>
        prev.map(workflow =>
          workflow.id === updated.id
            ? { ...workflow, ...updated }
            : workflow
        )
      )

      const normalized = normalizeWorkflowData(updated.data ?? payloadGraph)
      setWorkflowData(normalized)
      latestGraphRef.current = normalized

      const savedSnapshot = serializeSnapshot(
        {
          name: updated.name ?? currentWorkflow.name,
          description: updated.description ?? currentWorkflow.description ?? null
        },
        normalized
      )

      // Prepare diffs for logs from previous saved snapshot to new saved snapshot (user data only)
      try {
        const prevSaved = JSON.parse(lastSavedSnapshotRef.current)
        const currSaved = JSON.parse(savedSnapshot)
        const prevFlat = flatten(prevSaved)
        const currFlat = flatten(currSaved)
        const diffs: { path: string; from: unknown; to: unknown }[] = []
        const keys = new Set<string>([...Object.keys(prevFlat), ...Object.keys(currFlat)])
        for (const k of Array.from(keys).sort()) {
          if (!k.startsWith('graph.nodes[')) continue
          if (k.includes('.position')) continue
          if (!k.includes('.data.')) continue
          if (prevFlat[k] !== currFlat[k]) {
            diffs.push({ path: k, from: prevFlat[k], to: currFlat[k] })
            if (diffs.length >= 100) break
          }
        }
        if (diffs.length > 0) {
          addLog({
            id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}`,
            workflowId: updated.id,
            workflowName: updated.name ?? currentWorkflow.name,
            timestamp: Date.now(),
            diffs,
          })
        }
      } catch {}

      lastSavedSnapshotRef.current = savedSnapshot
      pendingSnapshotRef.current = null
      setWorkflowDirty(false)
    } catch (err) {
      console.error('Failed to save workflow', err)
      setError('Failed to save workflow.')
      pendingSnapshotRef.current = null
      window.alert('Failed to save workflow. Please try again.')
      handleGraphChange(latestGraphRef.current)
    } finally {
      setIsSaving(false)
      isSavingRef.current = false
    }
  }, [currentWorkflow, isSaving, normalizeWorkflowData, handleGraphChange])

  const toolbarWorkflow = useMemo(() => {
    if (!currentWorkflow) {
      return { id: '', name: '', list: workflowOptions }
    }
    return { id: currentWorkflow.id, name: currentWorkflow.name, list: workflowOptions }
  }, [currentWorkflow, workflowOptions])
  const [isGraphEmpty, setIsGraphEmpty] = useState<boolean>(() => {
    try { return (workflowData?.nodes?.length ?? 0) === 0 && (workflowData?.edges?.length ?? 0) === 0 } catch { return true }
  })
  const [templatesOpen, setTemplatesOpen] = useState(false)

  function DraggableTile({
    type,
    icon,
    gradient,
  }: { type: 'Trigger' | 'Action' | 'Condition'; icon: JSX.Element; gradient: string }) {
    return (
      <div
        draggable
        onDragStart={e => e.dataTransfer.setData('application/reactflow', type)}
        role="button"
        aria-label={`Add ${type}`}
        className={[
          'group relative overflow-hidden rounded-xl border shadow-sm cursor-grab active:cursor-grabbing select-none',
          'bg-gradient-to-br',
          gradient,
          'p-3 mb-3 text-white',
          'transition-transform will-change-transform hover:translate-y-[-1px] hover:shadow-md',
        ].join(' ')}
      >
        <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative z-10 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/15 ring-1 ring-white/20">
            {icon}
          </span>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">{type}</span>
            <span className="text-[11px] opacity-90">
              {type === 'Trigger' && 'Start your flow'}
              {type === 'Action' && 'Do something'}
              {type === 'Condition' && 'Branch logic'}
            </span>
          </div>
        </div>
      </div>
    )
  }
  function TemplateButton({ label, description, onClick, disabled }: { label: string; description?: string; onClick: () => void; disabled?: boolean }) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full text-left px-3 py-2 rounded-lg border bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 shadow-sm ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <div className="flex flex-col">
          <span className="text-sm font-medium">{label}</span>
          {description && <span className="text-xs text-zinc-500">{description}</span>}
        </div>
      </button>
    )
  }

  // React to workflow deletions initiated from Settings modal
  useEffect(() => {
    function onWorkflowDeleted(e: any) {
      const deletedId: string | undefined = e?.detail?.id
      if (!deletedId) return
      setWorkflows(prev => {
        const updated = prev.filter(w => w.id !== deletedId)
        if (currentWorkflowId === deletedId) {
          if (updated.length > 0) {
            const next = updated[0]
            setCurrentWorkflowId(next.id)
            const normalized = normalizeWorkflowData(next.data)
            setWorkflowData(normalized)
            latestGraphRef.current = normalized
            lastSavedSnapshotRef.current = serializeSnapshot(
              { name: next.name, description: next.description ?? null },
              normalized
            )
            pendingSnapshotRef.current = null
            setWorkflowDirty(false)
          } else {
            // No workflows left — create a fresh one
            handleNewWorkflow()
          }
        }
        return updated
      })
    }
    window.addEventListener('workflow-deleted', onWorkflowDeleted as any)
    return () => window.removeEventListener('workflow-deleted', onWorkflowDeleted as any)
  }, [currentWorkflowId, normalizeWorkflowData, handleNewWorkflow])

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header moved to DashboardLayout */}
      <div className="flex h-full">
      <aside className="w-64 border-r border-zinc-200 dark:border-zinc-700 p-4 bg-zinc-50 dark:bg-zinc-900">
        <h2 className="font-semibold mb-3 text-zinc-700 dark:text-zinc-200">Tasks</h2>
        <DraggableTile type="Trigger" icon={<TriggerIcon />} gradient="from-emerald-500 to-teal-600" />
        <DraggableTile type="Action" icon={<ActionIcon />} gradient="from-indigo-500 to-violet-600" />
        <DraggableTile type="Condition" icon={<ConditionIcon />} gradient="from-amber-500 to-orange-600" />
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setTemplatesOpen(v => !v)}
            className={`w-full text-left px-3 py-2 rounded-lg border shadow-sm flex items-center justify-between ${
              isGraphEmpty
                ? 'bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-400'
            }`}
            title={isGraphEmpty ? 'Browse templates' : (templatesOpen ? 'Hide templates' : 'Templates are disabled when the canvas is not empty')}
          >
            <span className="text-sm font-medium">Templates</span>
            <span className="text-xs text-zinc-500">{templatesOpen ? 'Hide' : 'Show'}</span>
          </button>
          {templatesOpen && (
            <div className={`mt-2 max-h-64 overflow-auto pr-1 space-y-2 ${isGraphEmpty ? '' : 'opacity-60'}`}>
              <TemplateButton
                label="HTTP Trigger → Webhook"
                description="Send a webhook when triggered"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'action-1', type: 'action', position: { x: 320, y: 120 }, data: { label: 'Webhook', expanded: true, actionType: 'http', params: { method: 'POST', url: 'https://example.com/webhook', headers: [{ key: 'Content-Type', value: 'application/json' }], bodyType: 'json', body: '{"event":"example","value":123}' }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [ { id: 'e1', source: 'trigger-1', target: 'action-1', type: 'nodeEdge', data: { edgeType: 'default' } } ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
              <TemplateButton
                label="Email on Trigger"
                description="Send an email via SMTP"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'action-1', type: 'action', position: { x: 320, y: 120 }, data: { label: 'Send Email', expanded: true, actionType: 'Send Email', params: { service: 'SMTP', from: '', to: '', subject: 'Welcome to Dsentr', body: 'This is a sample email from Dsentr.' }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [ { id: 'e1', source: 'trigger-1', target: 'action-1', type: 'nodeEdge', data: { edgeType: 'default' } } ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
              <TemplateButton
                label="SendGrid Email"
                description="Send via SendGrid"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'action-1', type: 'action', position: { x: 320, y: 120 }, data: { label: 'Send Email', expanded: true, actionType: 'Send Email', params: { service: 'SendGrid', from: '', to: '', subject: 'Welcome to Dsentr', body: 'This is a sample email from Dsentr.' }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [ { id: 'e1', source: 'trigger-1', target: 'action-1', type: 'nodeEdge', data: { edgeType: 'default' } } ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
              <TemplateButton
                label="Amazon SES Email"
                description="Send via Amazon SES"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'action-1', type: 'action', position: { x: 320, y: 120 }, data: { label: 'Send Email', expanded: true, actionType: 'Send Email', params: { service: 'Amazon SES', region: 'us-east-1', from: '', to: '', subject: 'Welcome to Dsentr', body: 'This is a sample email from Dsentr.' }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [ { id: 'e1', source: 'trigger-1', target: 'action-1', type: 'nodeEdge', data: { edgeType: 'default' } } ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
              <TemplateButton
                label="Mailgun Email"
                description="Send via Mailgun"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'action-1', type: 'action', position: { x: 320, y: 120 }, data: { label: 'Send Email', expanded: true, actionType: 'Send Email', params: { service: 'Mailgun', region: 'US (api.mailgun.net)', from: '', to: '', subject: 'Welcome to Dsentr', body: 'This is a sample email from Dsentr.' }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [ { id: 'e1', source: 'trigger-1', target: 'action-1', type: 'nodeEdge', data: { edgeType: 'default' } } ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
              <TemplateButton
                label="Messaging"
                description="Send a message (SMS/Chat)"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'action-1', type: 'action', position: { x: 320, y: 120 }, data: { label: 'Message', expanded: true, actionType: 'messaging', params: { platform: 'Slack', channel: '#general', message: 'Hello from Dsentr!', token: '' }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [ { id: 'e1', source: 'trigger-1', target: 'action-1', type: 'nodeEdge', data: { edgeType: 'default' } } ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
              <TemplateButton
                label="Google Sheets Append"
                description="Append a row on trigger"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'action-1', type: 'action', position: { x: 320, y: 120 }, data: { label: 'Google Sheets', expanded: true, actionType: 'sheets', params: { spreadsheetId: '', worksheet: 'Sheet1', columns: [{ key: 'timestamp', value: '{{now}}' }, { key: 'event', value: 'triggered' }] }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [ { id: 'e1', source: 'trigger-1', target: 'action-1', type: 'nodeEdge', data: { edgeType: 'default' } } ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
              <TemplateButton
                label="Run Code → HTTP"
                description="Process then call an API"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 60, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'action-1', type: 'action', position: { x: 280, y: 80 }, data: { label: 'Run Code', expanded: true, actionType: 'code', params: { language: 'js', code: '// transform inputs here\n// inputs available in scope: context\n// return an object to pass to next node', inputs: [], outputs: [] }, timeout: 5000, retries: 0, stopOnError: true } },
                    { id: 'action-2', type: 'action', position: { x: 500, y: 120 }, data: { label: 'HTTP Request', expanded: true, actionType: 'http', params: { method: 'GET', url: 'https://api.example.com/resource', headers: [], body: '' }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [
                    { id: 'e1', source: 'trigger-1', target: 'action-1', type: 'nodeEdge', data: { edgeType: 'default' } },
                    { id: 'e2', source: 'action-1', target: 'action-2', type: 'nodeEdge', data: { edgeType: 'default' } },
                  ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
              <TemplateButton
                label="Branch by Condition"
                description="Split flow into two paths"
                disabled={!isGraphEmpty}
                onClick={() => {
                  if (!saveRef.current?.loadGraph || !isGraphEmpty) return
                  const nodes = [
                    { id: 'trigger-1', type: 'trigger', position: { x: 40, y: 120 }, data: { label: 'Trigger', expanded: true, inputs: [], triggerType: 'Manual' } },
                    { id: 'cond-1', type: 'condition', position: { x: 260, y: 120 }, data: { label: 'If price > 100', expanded: true, field: 'price', operator: 'greater than', value: '100' } },
                    { id: 'action-true', type: 'action', position: { x: 520, y: 60 }, data: { label: 'Send Email (High)', expanded: true, actionType: 'Send Email', params: { service: 'SMTP', from: '', to: '', subject: 'High price detected', body: 'Price exceeded threshold.' }, timeout: 5000, retries: 0, stopOnError: true } },
                    { id: 'action-false', type: 'action', position: { x: 520, y: 180 }, data: { label: 'Slack Notify (Low)', expanded: true, actionType: 'messaging', params: { platform: 'Slack', channel: '#alerts', message: 'Price within normal range', token: '' }, timeout: 5000, retries: 0, stopOnError: true } },
                  ]
                  const edges = [
                    { id: 'e1', source: 'trigger-1', target: 'cond-1', type: 'nodeEdge', data: { edgeType: 'default' } },
                    { id: 'e2', source: 'cond-1', sourceHandle: 'cond-true', target: 'action-true', type: 'nodeEdge', data: { edgeType: 'default', outcome: 'true' }, label: 'True' },
                    { id: 'e3', source: 'cond-1', sourceHandle: 'cond-false', target: 'action-false', type: 'nodeEdge', data: { edgeType: 'default', outcome: 'false' }, label: 'False' },
                  ]
                  saveRef.current.loadGraph({ nodes, edges })
                }}
              />
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col bg-zinc-50 dark:bg-zinc-900">
        <WorkflowToolbar
          workflow={toolbarWorkflow}
          onSave={handleSave}
          onNew={handleNewWorkflow}
          onSelect={selectWorkflow}
          onRename={renameWorkflow}
          dirty={workflowDirty}
          saving={isSaving}
          runStatus={toolbarRunStatus}
          onToggleOverlay={handleToggleRunOverlay}
        />

        {/* Local tabs: Designer | Runs */}
        <div className="px-3 pt-2 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 backdrop-blur">
          <div className="flex items-center gap-2">
            <button
              className={`px-3 py-1.5 text-sm rounded-t ${activePane==='designer' ? 'bg-white dark:bg-zinc-900 border border-b-0 border-zinc-200 dark:border-zinc-700' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
              onClick={() => setActivePane('designer')}
            >
              Designer
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded-t ${activePane==='runs' ? 'bg-white dark:bg-zinc-900 border border-b-0 border-zinc-200 dark:border-zinc-700' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
              onClick={() => setActivePane('runs')}
            >
              Runs
            </button>
            {activePane==='runs' && (
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span className="text-zinc-500">Scope:</span>
                <select
                  value={runsScope}
                  onChange={e => setRunsScope((e.target.value as any) ?? 'current')}
                  className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
                >
                  <option value="current">Current workflow</option>
                  <option value="all">All workflows</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        {activePane === 'designer' ? (
          <ReactFlowProvider>
            {currentWorkflow ? (
              <FlowCanvas
                workflowId={currentWorkflow.id}
                workflowData={workflowData}
                markWorkflowDirty={markWorkflowDirty}
                setSaveRef={ref => (saveRef.current = ref)}
                onGraphChange={handleGraphChange}
                onRunWorkflow={handleRunWorkflow}
                runningIds={runningIds}
                succeededIds={succeededIds}
                failedIds={failedIds}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                {loadingWorkflows ? 'Loading workflows...' : 'Create a workflow to get started.'}
              </div>
            )}
          </ReactFlowProvider>
        ) : (
          // Runs pane
          <div className="flex-1 overflow-auto p-4">
            {runQueue.length === 0 ? (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">No queued or running jobs.</div>
            ) : (
              <div className="space-y-2">
                {runQueue.map(run => {
                  const wf = workflows.find(w => w.id === run.workflow_id)
                  const canCancel = run.status === 'queued' || run.status === 'running'
                  return (
                    <div key={run.id} className="flex items-center justify-between border rounded p-2 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700">
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-0.5 text-xs rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">{run.status}</span>
                        <div>
                          <div className="text-sm font-medium">{wf?.name || run.workflow_id}</div>
                          <div className="text-xs text-zinc-500">Started {new Date(run.started_at).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {canCancel && (
                          <button
                            className="text-xs px-2 py-1 rounded border hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            onClick={async () => {
                              try {
                                await cancelRun(run.workflow_id, run.id)
                                await fetchRunQueue()
                              } catch (e) {
                                console.error('Failed to cancel run', e)
                              }
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Unsaved changes confirm switch dialog */}
      {showSwitchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowSwitchConfirm(false); setPendingSwitchId(null) }} />
          <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-[420px] p-4 border border-zinc-200 dark:border-zinc-700">
            <h3 className="font-semibold mb-2">Unsaved changes</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-4">Save your current workflow before switching?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowSwitchConfirm(false); setPendingSwitchId(null) }}
                className="px-3 py-1 text-sm rounded border"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!pendingSwitchId) return
                  // Trigger save; the useEffect will perform the switch after save succeeds
                  handleSave()
                }}
                className="px-3 py-1 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                disabled={isSaving}
              >
                {isSaving ? 'Saving…' : 'Save and Switch'}
              </button>
              <button
                onClick={() => {
                  if (!pendingSwitchId) return
                  const target = pendingSwitchId
                  setShowSwitchConfirm(false)
                  setPendingSwitchId(null)
                  doSelectWorkflow(target)
                }}
                className="px-3 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700"
              >
                Discard and Switch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal moved to DashboardLayout */}

      {/* Run overlay */}
      {runOverlayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setRunOverlayOpen(false) }} />
          <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-[560px] max-h-[70vh] p-4 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">Run Status</h3>
              <button className="text-sm px-2 py-1 border rounded" onClick={() => { setRunOverlayOpen(false) }}>Close</button>
            </div>
            {!activeRun || (currentWorkflow && activeRun.workflow_id !== currentWorkflow.id) || (activeRun && (activeRun.status !== 'running' && activeRun.status !== 'queued')) ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">No active run for selected workflow.</p>
            ) : (
              <div className="space-y-2 text-sm relative">
                {runToast && (
                  <div className="absolute top-0 right-0 translate-y-[-8px] text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm">
                    {runToast}
                  </div>
                )}
                <div className="flex gap-2 items-center">
                  <span className="font-medium">Status:</span>
                  <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{activeRun.status}</span>
                  {activeRun.error && <span className="text-red-600 dark:text-red-400">{activeRun.error}</span>}
                  {(activeRun.status === 'queued' || activeRun.status === 'running') && currentWorkflow && (
                    <button
                      className="ml-2 text-xs px-2 py-0.5 rounded border"
                      disabled={cancelBusy}
                      onClick={async () => {
                        try {
                          setCancelBusy(true)
                          await cancelRun(currentWorkflow.id, activeRun.id)
                          setRunToast('Cancel requested…')
                          setTimeout(() => setRunToast(null), 2000)
                        } finally {
                          setCancelBusy(false)
                        }
                      }}
                    >
                      {cancelBusy ? 'Canceling…' : 'Cancel'}
                    </button>
                  )}
                </div>
                <div className="border rounded p-2 h-[42vh] overflow-auto bg-zinc-50 dark:bg-zinc-950/40">
                  {nodeRuns.length === 0 ? (
                    <div className="text-zinc-500">No node events yet…</div>
                  ) : (
                    nodeRuns.map(nr => (
                      <div key={nr.id} className="mb-2 border-b pb-2 last:border-b-0">
                        <div className="flex gap-2 items-center">
                          <span className="font-medium">{nr.name || nr.node_type || nr.node_id}</span>
                          <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{nr.status}</span>
                          {nr.error && <span className="text-red-600 dark:text-red-400">{nr.error}</span>}
                        </div>
                        {nr.outputs && (
                          <pre className="mt-1 text-xs whitespace-pre-wrap break-words bg-white/60 dark:bg-black/30 p-2 rounded">{JSON.stringify(nr.outputs, null, 2)}</pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}





















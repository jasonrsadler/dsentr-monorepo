import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@xyflow/react/dist/style.css'
import WorkflowToolbar from './Toolbar'
import FlowCanvas from './FlowCanvas'
import ActionIcon from '@/assets/svg-components/ActionIcon'
import ConditionIcon from '@/assets/svg-components/ConditionIcon'
import { ReactFlowProvider } from '@xyflow/react'
import { useWorkflowLogs } from '@/stores/workflowLogs'
import {
  listWorkflows,
  createWorkflow as createWorkflowApi,
  updateWorkflow as updateWorkflowApi,
  WorkflowRecord
} from '@/lib/workflowApi'

const TriggerIcon = () => (
  <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v20M2 12h20" />
  </svg>
)

const createEmptyGraph = () => ({ nodes: [] as any[], edges: [] as any[] })
function sortById<T extends { id: string }>(arr: T[]): T[] { return [...arr].sort((a, b) => a.id.localeCompare(b.id)) }
function sanitizeData(data: any) { if (!data || typeof data !== "object") return data; const { dirty, ...rest } = data as any; return rest; }

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
  } | null>(null)
  const lastSavedSnapshotRef = useRef<string>(
    serializeSnapshot({ name: '', description: null }, createEmptyGraph())
  )
  const pendingSnapshotRef = useRef<string | null>(null)
  const latestGraphRef = useRef<{ nodes: any[]; edges: any[] }>(createEmptyGraph())

  const normalizeWorkflowData = useCallback((data: any) => {
    if (data && typeof data === 'object') {
      const nodes = Array.isArray((data as any).nodes) ? (data as any).nodes : []
      const edges = Array.isArray((data as any).edges) ? (data as any).edges : []
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

      const nextWorkflow = workflows.find(workflow => workflow.id === id)
      setCurrentWorkflowId(id)
      setWorkflowDirty(false)
      setError(null)

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

      pendingSnapshotRef.current = null
    },
    [currentWorkflowId, workflows, normalizeWorkflowData]
  )

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
    },
    [currentMeta]
  )

  useEffect(() => {
    handleGraphChange(latestGraphRef.current)
  }, [currentMeta, handleGraphChange])

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
        />

        {error && (
          <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        <ReactFlowProvider>
          {currentWorkflow ? (
            <FlowCanvas
              workflowId={currentWorkflow.id}
              workflowData={workflowData}
              markWorkflowDirty={markWorkflowDirty}
              setSaveRef={ref => (saveRef.current = ref)}
              onGraphChange={handleGraphChange}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
              {loadingWorkflows ? 'Loading workflows...' : 'Create a workflow to get started.'}
            </div>
          )}
        </ReactFlowProvider>
      </div>
      </div>

      {/* Settings modal moved to DashboardLayout */}
    </div>
  )
}














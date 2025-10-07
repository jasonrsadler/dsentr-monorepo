import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@xyflow/react/dist/style.css'
import WorkflowToolbar from './Toolbar'
import FlowCanvas from './FlowCanvas'
import ActionIcon from '@/assets/svg-components/ActionIcon'
import ConditionIcon from '@/assets/svg-components/ConditionIcon'
import { ReactFlowProvider } from '@xyflow/react'
import SettingsButton from '@/components/Settings/SettingsButton'
import SettingsModal from '@/components/Settings/SettingsModal'
import WorkflowsTab from '@/components/Settings/tabs/WorkflowsTab'
import LogsTab from '@/components/Settings/tabs/LogsTab'
import PreferencesTab from '@/components/Settings/tabs/PreferencesTab'
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [disallowDuplicateNames, setDisallowDuplicateNames] = useState<boolean>(() => {
    const v = localStorage.getItem('pref_disallow_duplicate_names')
    return v ? v === '1' : false
  })
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
    try {
      setIsSaving(true)
      setError(null)

      const base = 'New Workflow'
      const names = new Set(workflows.map(w => w.name))
      let unique = base
      if (disallowDuplicateNames && names.has(unique)) {
        let i = 2
        while (names.has(`${base} (${i})`)) i++
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
  }, [normalizeWorkflowData])

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

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-violet-600" />
          <span className="font-semibold">DSentr</span>
        </div>
        <SettingsButton onOpenSettings={() => setSettingsOpen(true)} />
      </div>
      <div className="flex h-full">
      <aside className="w-64 border-r border-zinc-200 dark:border-zinc-700 p-4 bg-zinc-100 dark:bg-zinc-800">
        <h2 className="font-semibold mb-4 text-zinc-700 dark:text-zinc-200">Tasks</h2>
        {[
          { type: 'Trigger', icon: <TriggerIcon /> },
          { type: 'Action', icon: <ActionIcon /> },
          { type: 'Condition', icon: <ConditionIcon /> }
        ].map(({ type, icon }) => (
          <div
            key={type}
            draggable
            onDragStart={e => e.dataTransfer.setData('application/reactflow', type)}
            className="flex items-center justify-center gap-1 p-3 mb-2 rounded-lg shadow bg-white dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 cursor-grab transition"
          >
            {icon}
            <span className="text-sm font-medium">{type}</span>
          </div>
        ))}
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

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tabs={[
          { key: 'workflows', label: 'Workflows' },
          { key: 'logs', label: 'Logs' },
          { key: 'preferences', label: 'Preferences' },
        ]}
        renderTab={(key) => {
          if (key === 'workflows') {
            return (
              <WorkflowsTab
                workflows={workflows}
                onDeleted={(id) => {
                  setWorkflows((prev) => prev.filter((w) => w.id !== id))
                  if (currentWorkflowId === id) {
                    const next = workflows.find((w) => w.id !== id)
                    setCurrentWorkflowId(next?.id ?? null)
                    setWorkflowData(createEmptyGraph())
                  }
                }}
              />
            )
          }
          if (key === 'logs') return <LogsTab />
          return (
            <PreferencesTab
              disallowDuplicateNames={disallowDuplicateNames}
              onToggleDuplicateNames={(v) => {
                setDisallowDuplicateNames(v)
                localStorage.setItem('pref_disallow_duplicate_names', v ? '1' : '0')
              }}
            />
          )
        }}
      />
    </div>
  )
}














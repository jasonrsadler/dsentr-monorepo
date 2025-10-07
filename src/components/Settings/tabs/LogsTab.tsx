import { useEffect, useMemo, useState } from 'react'
import { getWorkflowLogs, listWorkflows, clearWorkflowLogs, deleteWorkflowLog, WorkflowLogEntry, WorkflowRecord } from '@/lib/workflowApi'

export default function LogsTab() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [workflowId, setWorkflowId] = useState<string>('')
  const [logs, setLogs] = useState<WorkflowLogEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    listWorkflows().then(ws => {
      setWorkflows(ws)
      if (ws[0]) setWorkflowId(ws[0].id)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!workflowId) { setLogs([]); return }
    setLoading(true)
    getWorkflowLogs(workflowId).then(setLogs).finally(() => setLoading(false))
  }, [workflowId])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-start gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm">Workflow</label>
          <select
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
            className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
          >
            {workflows.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <button
          className="text-sm underline text-zinc-600 dark:text-zinc-300 ml-2"
          onClick={async () => { if (workflowId) { await clearWorkflowLogs(workflowId); setLogs([]) } }}
          disabled={!workflowId}
        >
          Clear all
        </button>
      </div>

      {loading && <p className="text-sm text-zinc-500">Loading logs…</p>}
      {!loading && logs.length === 0 && (
        <p className="text-sm text-zinc-500">No logs.</p>
      )}

      <div className="space-y-4">
        {logs.map(e => (
          <div key={e.id} className="border border-zinc-200 dark:border-zinc-700 rounded p-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span>{(() => { const d = new Date(e.created_at as any); return isNaN(d.getTime()) ? String(e.created_at) : d.toLocaleString(); })()}</span>
              <button className="text-xs underline" onClick={async () => {
                await deleteWorkflowLog(e.workflow_id, e.id)
                setLogs(prev => prev.filter(x => x.id !== e.id))
              }}>Delete</button>
            </div>
            <ul className="text-xs space-y-1 max-h-48 overflow-auto">
              {(Array.isArray(e.diffs) ? e.diffs : []).map((d: any, i: number) => (
                <li key={i} className="font-mono">
                  {d.path}: {JSON.stringify(d.from)} → {JSON.stringify(d.to)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

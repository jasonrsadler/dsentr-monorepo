import { useEffect, useMemo, useState } from 'react'
import { useSecrets } from '@/contexts/SecretsContext'
import {
  getWorkflowLogs,
  listWorkflows,
  clearWorkflowLogs,
  deleteWorkflowLog,
  WorkflowLogEntry,
  WorkflowRecord
} from '@/lib/workflowApi'
import { flattenSecretValues, maskValueForPath } from '@/lib/secretMask'

export default function LogsTab() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [workflowId, setWorkflowId] = useState<string>('')
  const [logs, setLogs] = useState<WorkflowLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [workflowName, setWorkflowName] = useState<string>('')
  const { secrets } = useSecrets()
  const secretValues = useMemo(() => flattenSecretValues(secrets), [secrets])

  useEffect(() => {
    listWorkflows()
      .then((ws) => {
        setWorkflows(ws)
        if (ws[0]) setWorkflowId(ws[0].id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!workflowId) {
      setLogs([])
      setWorkflowName('')
      return
    }
    setLoading(true)
    getWorkflowLogs(workflowId)
      .then(({ workflow, logs }) => {
        setLogs(logs)
        if (workflow?.name) setWorkflowName(workflow.name)
        else {
          const w = workflows.find((w) => w.id === workflowId)
          setWorkflowName(w?.name ?? '')
        }
      })
      .finally(() => setLoading(false))
  }, [workflowId, workflows])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm">Workflow</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {workflowName && (
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              Viewing: <span className="font-medium">{workflowName}</span>
            </span>
          )}
        </div>
        <button
          className="text-sm underline"
          onClick={async () => {
            if (workflowId) {
              await clearWorkflowLogs(workflowId)
              setLogs([])
            }
          }}
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
    </div>
  )
}

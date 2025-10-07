import { useWorkflowLogs } from '@/stores/workflowLogs'

export default function LogsTab() {
  const { entries, clear } = useWorkflowLogs()
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Recent saves</h3>
        <button className="text-sm underline" onClick={clear}>Clear</button>
      </div>
      {entries.length === 0 && (
        <p className="text-sm text-zinc-500">No logs yet.</p>
      )}
      <div className="space-y-4">
        {entries.map(e => (
          <div key={e.id} className="border border-zinc-200 dark:border-zinc-700 rounded p-3">
            <div className="text-sm mb-2">
              <span className="font-medium">{e.workflowName}</span>
              <span className="text-zinc-500"> · {new Date(e.timestamp).toLocaleString()}</span>
            </div>
            <ul className="text-xs space-y-1 max-h-48 overflow-auto">
              {e.diffs.map((d, i) => (
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


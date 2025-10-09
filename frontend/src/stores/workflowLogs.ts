import { create } from 'zustand'

export type LogDiff = { path: string; from: unknown; to: unknown }
export type LogEntry = {
  id: string
  workflowId: string
  workflowName: string
  timestamp: number
  diffs: LogDiff[]
}

type WorkflowLogsState = {
  entries: LogEntry[]
  add: (entry: LogEntry) => void
  clear: () => void
}

export const useWorkflowLogs = create<WorkflowLogsState>((set) => ({
  entries: [],
  add: (entry) =>
    set((s) => ({ entries: [entry, ...s.entries].slice(0, 100) })),
  clear: () => set({ entries: [] })
}))

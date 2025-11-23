import { create } from 'zustand'
import { getPlanUsage, type PlanUsageSummary } from '@/lib/workflowApi'

type PlanUsageState = {
  usage: PlanUsageSummary | null
  loading: boolean
  error: string | null
  workspaceRunCapReached: boolean
  setUsage: (usage: PlanUsageSummary | null) => void
  refresh: (workspaceId?: string | null) => Promise<PlanUsageSummary | null>
  markWorkspaceRunCap: () => void
}

export const usePlanUsageStore = create<PlanUsageState>((set, get) => ({
  usage: null,
  loading: false,
  error: null,
  workspaceRunCapReached: false,
  setUsage: (usage) => set({ usage }),
  refresh: async (workspaceId?: string | null) => {
    if (get().loading) {
      return get().usage
    }
    set({ loading: true })
    try {
      const usage = await getPlanUsage(workspaceId)
      set({ usage, error: null, workspaceRunCapReached: false })
      return usage
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message || 'Failed to load plan usage'
          : 'Failed to load plan usage'
      set({ error: message })
      return null
    } finally {
      set({ loading: false })
    }
  },
  markWorkspaceRunCap: () => set({ workspaceRunCapReached: true })
}))

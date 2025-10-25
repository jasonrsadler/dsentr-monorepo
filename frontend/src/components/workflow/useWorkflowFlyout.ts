import { createContext, useContext } from 'react'

export interface WorkflowFlyoutContextValue {
  openFlyout: (nodeId: string | null) => void
  activeNodeId: string | null
  isFlyoutRender: boolean
}

const WorkflowFlyoutContext = createContext<WorkflowFlyoutContextValue>({
  openFlyout: () => undefined,
  activeNodeId: null,
  isFlyoutRender: false
})

export const WorkflowFlyoutProvider = WorkflowFlyoutContext.Provider

export function useWorkflowFlyout(): WorkflowFlyoutContextValue {
  return useContext(WorkflowFlyoutContext)
}

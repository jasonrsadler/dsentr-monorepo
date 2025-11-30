import { ReactFlowProvider } from '@xyflow/react'

export function TestFlowWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>
}

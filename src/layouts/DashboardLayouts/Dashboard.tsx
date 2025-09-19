import { useCallback, useMemo, useRef, useState } from 'react'
import '@xyflow/react/dist/style.css'
import WorkflowToolbar from './Toolbar'
import FlowCanvas from './FlowCanvas'
import ActionIcon from '@/assets/svg-components/ActionIcon'
import ConditionIcon from '@/assets/svg-components/ConditionIcon'
import { ReactFlowProvider } from '@xyflow/react'

const TriggerIcon = () => (
  <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v20M2 12h20" />
  </svg>
)

export default function Dashboard() {
  const [workflows, setWorkflows] = useState([{ id: 'wf-1', name: 'Workflow 1' }])
  const [currentWorkflowId, setCurrentWorkflowId] = useState(workflows[0]?.id)
  const [workflowDirty, setWorkflowDirty] = useState(false)

  const saveRef = useRef<{ saveAllNodes?: () => any[]; getEdges?: () => any[] } | null>(null)

  const currentWorkflow = useMemo(
    () => ({ id: currentWorkflowId, list: workflows }),
    [currentWorkflowId, workflows]
  )

  const markWorkflowDirty = useCallback(() => setWorkflowDirty(true), [])

  const saveWorkflow = (nodes: any[], edges: any[]) => {
    console.log('Saving workflow', currentWorkflowId, { nodes, edges })
    setWorkflowDirty(false)
  }

  const handleSave = () => {
    if (!saveRef.current) return

    const nodesData = saveRef.current.saveAllNodes?.() || []
    const edgesData = saveRef.current.getEdges?.() || []

    // map nodes for API
    const cleanNodes = nodesData.map(({ id, type, position, data }) => ({ id, type, position, data }))
    const cleanEdges = edgesData.map(({ id, source, target, type }) => ({ id, source, target, type }))

    // Clear dirty on nodes that have no errors
    const updatedNodes = cleanNodes.map(n => {
      const hasDuplicateKeys = n.data?.inputs?.map(i => i.key.trim()).filter(k => k).length !==
        new Set(n.data?.inputs?.map(i => i.key.trim()).filter(k => k)).size
      const hasInvalidInputs = n.data?.inputs?.some(i => !i.key.trim() || !i.value.trim())
      return { ...n, data: { ...n.data, dirty: hasDuplicateKeys || hasInvalidInputs } }
    })

    // Push updated dirty state back to FlowCanvas nodes
    saveRef.current.setNodesFromToolbar?.(updatedNodes)

    saveWorkflow(cleanNodes, cleanEdges)
  }


  const createWorkflow = () => {
    const newWorkflow = { id: `wf-${+new Date()}`, name: 'New Workflow' }
    setWorkflows(prev => [...prev, newWorkflow])
    setCurrentWorkflowId(newWorkflow.id)
    setWorkflowDirty(false)
  }

  const selectWorkflow = (id: string) => {
    setCurrentWorkflowId(id)
    setWorkflowDirty(false)
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
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
          workflow={currentWorkflow}
          onSave={handleSave}
          onNew={createWorkflow}
          onSelect={selectWorkflow}
          dirty={workflowDirty}
        />
        <ReactFlowProvider>
          <FlowCanvas
            markWorkflowDirty={markWorkflowDirty}
            setSaveRef={ref => (saveRef.current = ref)}
          />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

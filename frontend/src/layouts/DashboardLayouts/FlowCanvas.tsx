import { useCallback, useMemo, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState
} from '@xyflow/react'
import TriggerNode from '@/components/Workflow/TriggerNode'
import ActionNode from '@/components/Workflow/ActionNode'
import NodeEdge from '@/components/Workflow/NodeEdge'
import CustomControls from '@/components/UI/ReactFlow/CustomControl'
import ConditionNode from '@/components/Workflow/ConditionNode'

function normalizeNode(n: any) {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: sanitizeData(n.data)
  }
}
function normalizeEdge(e: any) {
  // Coalesce potentially undefined fields to stable values so snapshots match
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
    animated
  }
}
function sortById<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.id.localeCompare(b.id))
}

function sanitizeData(data: any) {
  if (!data || typeof data !== 'object') return data
  const { dirty, wfEpoch, ...rest } = data as any
  return rest
}

interface FlowCanvasProps {
  isDark?: boolean
  markWorkflowDirty: () => void
  setSaveRef?: (ref: {
    saveAllNodes: () => any[]
    getEdges: () => any[]
    setNodesFromToolbar: (updatedNodes: any[]) => void
    loadGraph: (graph: { nodes: any[]; edges: any[] }) => void
  }) => void
  workflowId?: string | null
  workflowData?: { nodes: any[]; edges: any[] }
  onGraphChange?: (graph: { nodes: any[]; edges: any[] }) => void
  onRunWorkflow?: () => void
  runningIds?: Set<string>
  succeededIds?: Set<string>
  failedIds?: Set<string>
}

export default function FlowCanvas({
  isDark,
  markWorkflowDirty,
  setSaveRef,
  workflowId,
  workflowData,
  onGraphChange,
  onRunWorkflow,
  runningIds = new Set(),
  succeededIds = new Set(),
  failedIds = new Set()
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState([])
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState([])
  const rafRef = useRef<number | null>(null)
  // Keep a stable callable for run to avoid re-creating nodeTypes
  const onRunWorkflowRef = useRef(onRunWorkflow)
  useEffect(() => {
    onRunWorkflowRef.current = onRunWorkflow
  }, [onRunWorkflow])
  const invokeRunWorkflow = useCallback(() => {
    onRunWorkflowRef.current?.()
  }, [])
  useEffect(() => {
    if (!workflowId) {
      setNodes([])
      setEdges([])
      return
    }
    // Deep clone node data to avoid shared references across workflow switches
    const epoch = Date.now()
    const incomingNodes = (workflowData?.nodes ?? []).map((node: any) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        ...(node?.data ? JSON.parse(JSON.stringify(node.data)) : {}),
        dirty: Boolean(node?.data?.dirty),
        wfEpoch: epoch
      }
    }))
    const incomingEdges = (workflowData?.edges ?? []).map((e: any) => ({
      ...e
    }))
    setNodes(incomingNodes)
    setEdges(incomingEdges)
  }, [workflowId, workflowData, setNodes, setEdges])
  useEffect(() => {
    if (!onGraphChange) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const nodesSnap = nodes
    const edgesSnap = edges
    rafRef.current = requestAnimationFrame(() => {
      const cleanNodes = sortById(nodesSnap.map(normalizeNode))
      const cleanEdges = sortById(edgesSnap.map(normalizeEdge))
      onGraphChange({ nodes: cleanNodes, edges: cleanEdges })
    })
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [nodes, edges, onGraphChange])

  // Keep execution state in refs so `nodeTypes` identity stays stable across polls
  const runningIdsRef = useRef(runningIds)
  const succeededIdsRef = useRef(succeededIds)
  const failedIdsRef = useRef(failedIds)
  useEffect(() => {
    runningIdsRef.current = runningIds
  }, [runningIds])
  useEffect(() => {
    succeededIdsRef.current = succeededIds
  }, [succeededIds])
  useEffect(() => {
    failedIdsRef.current = failedIds
  }, [failedIds])

  const updateNodeData = useCallback(
    (id: string, newData: any, suppressDirty = false) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...newData } } : n
        )
      )
      if (!suppressDirty) markWorkflowDirty()
    },
    [setNodes, markWorkflowDirty]
  )

  const saveAllNodes = useCallback(() => {
    const clearedNodes = nodes.map((n) => {
      const keys = n.data?.inputs?.map((i) => i.key.trim()) || []
      const values = n.data?.inputs?.map((i) => i.value.trim()) || []

      const hasDuplicateKeys =
        new Set(keys.filter((k) => k)).size !== keys.filter((k) => k).length
      const hasInvalidInputs = keys.some((k) => !k) || values.some((v) => !v)

      const newDirty = hasDuplicateKeys || hasInvalidInputs

      return {
        ...n,
        data: { ...n.data, dirty: newDirty }
      }
    })

    setNodes(clearedNodes)

    return clearedNodes
  }, [nodes, setNodes])
  useEffect(() => {
    if (setSaveRef) {
      setSaveRef({
        saveAllNodes,
        getEdges: () => edges,
        setNodesFromToolbar: (updatedNodes) =>
          setNodes((nds) =>
            nds.map((n) => {
              const updated = updatedNodes.find((u) => u.id === n.id)
              return updated
                ? { ...n, data: { ...n.data, ...updated.data } }
                : n
            })
          ),
        loadGraph: (graph) => {
          const epoch = Date.now()
          const safeNodes = (graph?.nodes ?? []).map((n: any) => ({
            ...n,
            data: {
              ...(n.data ?? {}),
              dirty: n.data?.dirty ?? false,
              wfEpoch: epoch
            }
          }))
          setNodes(safeNodes)
          setEdges(graph?.edges ?? [])
          markWorkflowDirty()
        }
      })
    }
  }, [edges, saveAllNodes, setSaveRef, setNodes])

  const removeNode = useCallback(
    (id) => {
      setNodes((nds) => nds.filter((n) => n.id !== id))
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
      markWorkflowDirty()
    },
    [setNodes, setEdges, markWorkflowDirty]
  )

  const nodeTypes = useMemo(
    () => ({
      trigger: (props) => (
        <TriggerNode
          key={`trigger-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
          onRemove={removeNode}
          onDirtyChange={markWorkflowDirty}
          onUpdateNode={updateNodeData}
          onRun={() => {
            invokeRunWorkflow()
          }}
        />
      ),
      action: (props) => (
        <ActionNode
          key={`action-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
          onRemove={removeNode}
          onDirtyChange={markWorkflowDirty}
          onUpdateNode={updateNodeData}
          onRun={() => {
            invokeRunWorkflow()
          }}
        />
      ),
      condition: (props) => (
        <ConditionNode
          key={`condition-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
          onRemove={removeNode}
          onDirtyChange={markWorkflowDirty}
          onUpdateNode={updateNodeData}
          onRun={() => {
            console.log('Run Condition', props.id)
          }}
        />
      )
    }),
    [removeNode, markWorkflowDirty, updateNodeData, invokeRunWorkflow]
  )

  const onNodesChange = useCallback(
    (changes) => {
      markWorkflowDirty()
      onNodesChangeInternal(changes)
    },
    [onNodesChangeInternal, markWorkflowDirty]
  )

  const onEdgesChange = useCallback(
    (changes) => {
      markWorkflowDirty()
      onEdgesChangeInternal(changes)
    },
    [onEdgesChangeInternal, markWorkflowDirty]
  )

  const onConnect = useCallback(
    (params) => {
      const outcomeLabel =
        params?.sourceHandle === 'cond-true'
          ? 'True'
          : params?.sourceHandle === 'cond-false'
            ? 'False'
            : null
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'nodeEdge',
            label: outcomeLabel,
            data: {
              edgeType: 'default',
              outcome: outcomeLabel?.toLowerCase?.()
            }
          },
          eds
        )
      )
    },
    [setEdges]
  )

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow')
      if (!type) return

      const bounds = event.currentTarget.getBoundingClientRect()
      const position = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      }

      const newNode = {
        id: `${type}-${+new Date()}`,
        type: type.toLowerCase(),
        position,
        data: {
          label: type,
          expanded: ['trigger', 'action', 'condition'].includes(
            type.toLowerCase()
          ),
          dirty: true,
          inputs: []
        }
      }

      setNodes((nds) => [...nds, newNode])
      markWorkflowDirty()
    },
    [setNodes, markWorkflowDirty]
  )

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleEdgeTypeChange = useCallback(
    (edgeId, newType) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId ? { ...e, data: { ...e.data, edgeType: newType } } : e
        )
      )
    },
    [setEdges]
  )

  const handleEdgeDelete = useCallback(
    (edgeId) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId))
    },
    [setEdges]
  )

  const edgeTypes = useMemo(
    () => ({
      nodeEdge: (edgeProps) => (
        <NodeEdge
          {...edgeProps}
          onDelete={handleEdgeDelete}
          onChangeType={handleEdgeTypeChange}
        />
      )
    }),
    [handleEdgeDelete, handleEdgeTypeChange]
  )

  return (
    <ReactFlow
      key={workflowId || 'no-workflow'}
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onDrop={onDrop}
      onDragOver={onDragOver}
      fitView
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      className="flex-1"
    >
      <Background gap={16} size={1} />
      <div className={isDark ? 'text-white' : 'text-black'}>
        <CustomControls />
        <MiniMap
          nodeColor={(node) =>
            node.type === 'trigger' ? '#10B981' : '#6366F1'
          }
          style={{ background: 'transparent' }}
        />
      </div>
    </ReactFlow>
  )
}

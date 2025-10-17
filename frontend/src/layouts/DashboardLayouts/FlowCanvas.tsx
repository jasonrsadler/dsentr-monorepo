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
import { normalizePlanTier } from '@/lib/planTiers'

function normalizeNode(n: any) {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: sanitizeData(n.data)
  }
}
function normalizeEdge(e: any) {
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

const LABEL_MESSAGES = {
  spaces: 'Node names cannot contain spaces.',
  duplicate: 'Node name must be unique.'
} as const

type FlowNode = {
  id: string
  data?: Record<string, any>
  [key: string]: any
}

function sanitizeLabelInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function countExistingLabels(nodes: FlowNode[]): Map<string, number> {
  const counts = new Map<string, number>()
  nodes.forEach((node) => {
    const label = sanitizeLabelInput(node?.data?.label)
    if (!label) return
    const key = label.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return counts
}

function generateUniqueLabel(baseLabel: string, nodes: FlowNode[]): string {
  const trimmed = sanitizeLabelInput(baseLabel)
  const normalizedBase = trimmed.replace(/\s+/g, '') || 'Node'
  const counts = countExistingLabels(nodes)
  if ((counts.get(normalizedBase.toLowerCase()) ?? 0) === 0) {
    return normalizedBase
  }
  let suffix = 2
  let candidate = `${normalizedBase}${suffix}`
  while ((counts.get(candidate.toLowerCase()) ?? 0) > 0) {
    suffix += 1
    candidate = `${normalizedBase}${suffix}`
  }
  return candidate
}

function shallowEqualData(
  a: Record<string, any> | undefined,
  b: Record<string, any>
): boolean {
  if (!a) return Object.keys(b).length === 0
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function reconcileNodeLabels(nodes: FlowNode[]): FlowNode[] {
  const metadata = nodes.map((node) => {
    const trimmed = sanitizeLabelInput(node?.data?.label)
    return {
      trimmed,
      hasSpaces: /\s/.test(trimmed),
      normalized: trimmed.toLowerCase()
    }
  })
  const counts = new Map<string, number>()
  metadata.forEach(({ trimmed, normalized }) => {
    if (!trimmed) return
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  })
  let hasChanges = false
  const nextNodes = nodes.map((node, index) => {
    const prevData = node.data ?? {}
    const { trimmed, hasSpaces, normalized } = metadata[index]
    let labelError: string | null = null
    if (trimmed && hasSpaces) {
      labelError = LABEL_MESSAGES.spaces
    } else if (trimmed && (counts.get(normalized) ?? 0) > 1) {
      labelError = LABEL_MESSAGES.duplicate
    }
    const hasLabelValidationError = Boolean(labelError)
    const nextDataShouldChange =
      prevData.label !== trimmed ||
      (prevData.labelError ?? null) !== labelError ||
      Boolean(prevData.hasLabelValidationError) !== hasLabelValidationError

    if (!nextDataShouldChange) return node
    hasChanges = true
    return {
      ...node,
      data: {
        ...prevData,
        label: trimmed,
        labelError,
        hasLabelValidationError
      }
    }
  })
  return hasChanges ? nextNodes : nodes
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
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
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
  failedIds = new Set(),
  planTier,
  onRestrictionNotice
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState([])
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState([])
  const normalizedPlanTier = useMemo(
    () => normalizePlanTier(planTier),
    [planTier]
  )
  const isSoloPlan = normalizedPlanTier === 'solo'
  const rafRef = useRef<number | null>(null)

  const onRunWorkflowRef = useRef(onRunWorkflow)
  useEffect(() => {
    onRunWorkflowRef.current = onRunWorkflow
  }, [onRunWorkflow])

  const invokeRunWorkflow = useCallback(() => {
    onRunWorkflowRef.current?.()
  }, [])

  // Keep markWorkflowDirty stable via ref
  const markWorkflowDirtyRef = useRef(markWorkflowDirty)
  useEffect(() => {
    markWorkflowDirtyRef.current = markWorkflowDirty
  }, [markWorkflowDirty])

  useEffect(() => {
    if (!workflowId) {
      setNodes([])
      setEdges([])
      return
    }
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
    setNodes(reconcileNodeLabels(incomingNodes))
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
      setNodes((nds) => {
        let didChange = false
        const updated = nds.map((n) => {
          if (n.id !== id) return n
          const prevData = n.data ?? {}
          const mergedData = { ...prevData, ...newData }
          if (shallowEqualData(prevData, mergedData)) return n
          didChange = true
          return { ...n, data: mergedData }
        })
        const reconciled = reconcileNodeLabels(updated)
        if (!didChange && reconciled === updated) return nds
        return reconciled
      })
      if (!suppressDirty) markWorkflowDirtyRef.current()
    },
    [setNodes]
  )

  const saveAllNodes = useCallback(() => {
    const clearedNodes = nodes.map((n) => {
      const keys = n.data?.inputs?.map((i) => i.key.trim()) || []
      const values = n.data?.inputs?.map((i) => i.value.trim()) || []
      const hasDuplicateKeys =
        new Set(keys.filter((k) => k)).size !== keys.filter((k) => k).length
      const hasInvalidInputs = keys.some((k) => !k) || values.some((v) => !v)
      const newDirty = hasDuplicateKeys || hasInvalidInputs
      return { ...n, data: { ...n.data, dirty: newDirty } }
    })
    setNodes(reconcileNodeLabels(clearedNodes))
    return clearedNodes
  }, [nodes, setNodes])

  useEffect(() => {
    if (!setSaveRef) return
    setSaveRef({
      saveAllNodes,
      getEdges: () => edges,
      setNodesFromToolbar: (updatedNodes) =>
        setNodes((nds) => {
          let changed = false
          const mapped = nds.map((n) => {
            const updated = updatedNodes.find((u) => u.id === n.id)
            if (!updated) return n
            const prevData = n.data ?? {}
            const nextData = { ...prevData, ...updated.data }
            if (shallowEqualData(prevData, nextData)) return n
            changed = true
            return { ...n, data: nextData }
          })
          const reconciled = reconcileNodeLabels(mapped)
          if (!changed && reconciled === mapped) return nds
          return reconciled
        }),
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
        setNodes(reconcileNodeLabels(safeNodes))
        setEdges(graph?.edges ?? [])
        markWorkflowDirtyRef.current()
      }
    })
  }, [edges, saveAllNodes, setSaveRef, setNodes, setEdges])

  const removeNode = useCallback(
    (id) => {
      setNodes((nds) => nds.filter((n) => n.id !== id))
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
      markWorkflowDirtyRef.current()
    },
    [setNodes, setEdges]
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
          onDirtyChange={markWorkflowDirtyRef.current}
          onUpdateNode={updateNodeData}
          onRun={() => invokeRunWorkflow()}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
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
          onDirtyChange={markWorkflowDirtyRef.current}
          onUpdateNode={updateNodeData}
          onRun={() => invokeRunWorkflow()}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
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
          onDirtyChange={markWorkflowDirtyRef.current}
          onUpdateNode={updateNodeData}
          onRun={() => console.log('Run Condition', props.id)}
        />
      )
    }),
    [
      removeNode,
      updateNodeData,
      invokeRunWorkflow,
      normalizedPlanTier,
      onRestrictionNotice
    ]
  )

  const onNodesChange = useCallback(
    (changes) => {
      markWorkflowDirtyRef.current()
      onNodesChangeInternal(changes)
    },
    [onNodesChangeInternal]
  )

  const onEdgesChange = useCallback(
    (changes) => {
      markWorkflowDirtyRef.current()
      onEdgesChangeInternal(changes)
    },
    [onEdgesChangeInternal]
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
      setNodes((nds) => {
        if (isSoloPlan && nds.length >= 10) {
          onRestrictionNotice?.(
            'Solo plan workflows support up to 10 nodes. Upgrade in Settings → Plan to add more steps.'
          )
          return nds
        }
        const label = generateUniqueLabel(type, nds)
        const newNode = {
          id: `${type}-${+new Date()}`,
          type: type.toLowerCase(),
          position,
          data: {
            label,
            expanded: ['trigger', 'action', 'condition'].includes(
              type.toLowerCase()
            ),
            dirty: true,
            inputs: [],
            labelError: null,
            hasLabelValidationError: false
          }
        }
        const withNewNode = [...nds, newNode]
        return reconcileNodeLabels(withNewNode)
      })
      markWorkflowDirtyRef.current()
    },
    [setNodes, isSoloPlan, onRestrictionNotice]
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

import { useCallback, useMemo, useEffect, useRef, type DragEvent } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type EdgeProps,
  type EdgeTypes,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type NodeProps
} from '@xyflow/react'
import TriggerNode from '@/components/workflow/TriggerNode'
import ActionNode from '@/components/workflow/ActionNode'
import NodeEdge from '@/components/workflow/NodeEdge'
import CustomControls from '@/components/ui/react-flow/CustomControl'
import ConditionNode from '@/components/workflow/ConditionNode'
import { normalizePlanTier } from '@/lib/planTiers'
import {
  useWorkflowStore,
  type FlowNode,
  type FlowEdge,
  generateUniqueLabel,
  reconcileNodeLabels
} from '@/stores/workflowStore'

function normalizeNode(n: any): FlowNode {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: sanitizeData(n.data)
  } as FlowNode
}
function normalizeEdge(e: any): FlowEdge {
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
  } as FlowEdge
}
function sortById<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.id.localeCompare(b.id))
}

function sanitizeData(data: any) {
  if (!data || typeof data !== 'object') return data
  const { dirty, wfEpoch, ...rest } = data as any
  return rest
}

type EdgeStyleVariant = 'default' | 'bold' | 'dashed'

const EMPTY_STATUS_SET = new Set<string>()

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
interface FlowCanvasProps {
  isDark?: boolean
  markWorkflowDirty: () => void
  setSaveRef?: (ref: {
    saveAllNodes: () => FlowNode[]
    getEdges: () => FlowEdge[]
    setNodesFromToolbar: (
      updatedNodes: FlowNode[],
      options?: { markDirty?: boolean }
    ) => void
    loadGraph: (graph: { nodes: FlowNode[]; edges: FlowEdge[] }) => void
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
  canEdit?: boolean
}

export default function FlowCanvas({
  isDark,
  markWorkflowDirty,
  setSaveRef,
  workflowId,
  workflowData,
  onGraphChange,
  onRunWorkflow,
  runningIds,
  succeededIds,
  failedIds,
  planTier,
  onRestrictionNotice,
  canEdit = true
}: FlowCanvasProps) {
  const nodes = useWorkflowStore((state) => state.nodes)
  const edges = useWorkflowStore((state) => state.edges)
  const setNodeStatuses = useWorkflowStore((state) => state.setNodeStatuses)
  const reactFlow = useReactFlow()
  const normalizedPlanTier = useMemo(
    () => normalizePlanTier(planTier),
    [planTier]
  )
  const isSoloPlan = normalizedPlanTier === 'solo'
  const rafRef = useRef<number | null>(null)
  const canEditRef = useRef<boolean>(canEdit)
  const markStoreDirty = useMemo(
    () => useWorkflowStore.getState().markDirty,
    []
  )
  const { lock, unlock, clearDirty } = useMemo(() => {
    const store = useWorkflowStore.getState()
    return {
      lock: store.lock,
      unlock: store.unlock,
      clearDirty: store.clearDirty
    }
  }, [])

  useEffect(() => {
    canEditRef.current = canEdit
  }, [canEdit])

  const onRunWorkflowRef = useRef(onRunWorkflow)
  useEffect(() => {
    onRunWorkflowRef.current = onRunWorkflow
  }, [onRunWorkflow])

  const invokeRunWorkflow = useCallback(() => {
    onRunWorkflowRef.current?.()
  }, [])

  const markWorkflowDirtyRef = useRef(markWorkflowDirty)
  useEffect(() => {
    markWorkflowDirtyRef.current = markWorkflowDirty
  }, [markWorkflowDirty])

  useEffect(() => {
    const store = useWorkflowStore.getState()
    lock()
    try {
      if (!workflowId) {
        store.loadWorkflow({ workflowId: null, nodes: [], edges: [] })
        clearDirty()
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
      })) as FlowNode[]
      const incomingEdges = (workflowData?.edges ?? []).map((edge: any) => ({
        ...edge
      })) as FlowEdge[]
      const { nodes: reconciledNodes } = reconcileNodeLabels(incomingNodes)
      store.loadWorkflow({
        workflowId,
        nodes: reconciledNodes,
        edges: incomingEdges
      })
      clearDirty()
    } finally {
      unlock()
    }
  }, [workflowId, workflowData, clearDirty, lock, unlock])

  useEffect(() => {
    if (!onGraphChange) return

    const emitGraph = (nodesSnap: FlowNode[], edgesSnap: FlowEdge[]) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      const cleanNodes = sortById(nodesSnap.map(normalizeNode))
      const cleanEdges = sortById(edgesSnap.map(normalizeEdge))
      rafRef.current = requestAnimationFrame(() => {
        onGraphChange({ nodes: cleanNodes, edges: cleanEdges })
      })
    }

    const current = useWorkflowStore.getState()
    emitGraph(current.nodes, current.edges)

    const unsubscribe = useWorkflowStore.subscribe(
      (state) => ({ nodes: state.nodes, edges: state.edges }),
      (snapshot, previous) => {
        if (
          snapshot.nodes === previous?.nodes &&
          snapshot.edges === previous?.edges
        ) {
          return
        }
        emitGraph(snapshot.nodes, snapshot.edges)
      }
    )

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      unsubscribe()
    }
  }, [onGraphChange])

  useEffect(() => {
    setNodeStatuses(
      runningIds ?? EMPTY_STATUS_SET,
      succeededIds ?? EMPTY_STATUS_SET,
      failedIds ?? EMPTY_STATUS_SET
    )
  }, [failedIds, runningIds, setNodeStatuses, succeededIds])

  const handleNodeChange = useCallback(
    (id: string, newData: Record<string, any>, suppressDirty = false) => {
      if (!canEditRef.current) return
      const store = useWorkflowStore.getState()
      if (store.locked) return
      const changed = store.mergeNodeData(id, newData, {
        markDirty: !suppressDirty,
        reconcileLabels: true
      })
      if (!changed) {
        return
      }
      if (!suppressDirty) {
        markWorkflowDirtyRef.current()
      }
    },
    []
  )

  const saveAllNodes = useCallback((): FlowNode[] => {
    const store = useWorkflowStore.getState()
    if (!canEditRef.current) {
      return store.nodes
    }
    const { nodes: labelNormalizedNodes, changed: labelsChanged } =
      reconcileNodeLabels(store.nodes)
    const nodesForDirty = labelsChanged ? labelNormalizedNodes : store.nodes

    let dirtyChanged = false
    const normalizedNodes = nodesForDirty.map((node) => {
      const prevData = node.data ?? {}
      const hadDirtyFlag = Boolean(prevData.dirty)
      if (!hadDirtyFlag) {
        return node
      }

      dirtyChanged = true
      return {
        ...node,
        data: {
          ...prevData,
          dirty: false
        }
      }
    })

    if (!dirtyChanged && !labelsChanged) {
      return store.nodes
    }

    store.setNodes(normalizedNodes, { markDirty: false })
    return normalizedNodes
  }, [])

  const getEdgesSnapshot = useCallback(() => {
    return useWorkflowStore.getState().edges
  }, [])

  const setNodesFromToolbar = useCallback(
    (updatedNodes: FlowNode[], options?: { markDirty?: boolean }) => {
      if (!canEditRef.current) return
      const store = useWorkflowStore.getState()
      const { markDirty = true } = options ?? {}
      if (store.locked && markDirty) return
      let didChange = false
      const mapped = store.nodes.map((node) => {
        const updatedNode = updatedNodes.find(
          (candidate) => candidate.id === node.id
        )
        if (!updatedNode) return node
        const prevData = node.data ?? {}
        const nextData = {
          ...prevData,
          ...(updatedNode.data ?? {})
        }
        if (shallowEqualData(prevData, nextData)) return node
        didChange = true
        return { ...node, data: nextData }
      })
      const { nodes: reconciled, changed } = reconcileNodeLabels(mapped)
      if (!didChange && !changed) {
        return
      }
      if (!markDirty) {
        store.setNodes(reconciled, { markDirty: false })
        return
      }
      store.setNodes(reconciled, { markDirty: true })
      markWorkflowDirtyRef.current()
    },
    []
  )

  const loadGraphFromToolbar = useCallback(
    (graph: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      const store = useWorkflowStore.getState()
      const epoch = Date.now()
      const safeNodes = (graph?.nodes ?? []).map((node) => ({
        ...node,
        data: {
          ...(node.data ?? {}),
          dirty:
            Boolean(node.data?.dirty) ||
            Boolean(node.data?.hasValidationErrors) ||
            Boolean(node.data?.childHasValidationErrors) ||
            Boolean(node.data?.labelError) ||
            Boolean(node.data?.hasLabelValidationError),
          wfEpoch: epoch
        }
      })) as FlowNode[]
      const safeEdges = (graph?.edges ?? []).map((edge) => ({
        ...edge
      })) as FlowEdge[]
      const { nodes: reconciled } = reconcileNodeLabels(safeNodes)
      lock()
      try {
        store.replaceGraph(reconciled, safeEdges, { markDirty: false })
        clearDirty()
      } finally {
        unlock()
      }
    },
    [clearDirty, lock, unlock]
  )

  const handleInit = useCallback(() => {
    unlock()
  }, [unlock])

  useEffect(() => {
    if (!setSaveRef) return
    setSaveRef({
      saveAllNodes,
      getEdges: getEdgesSnapshot,
      setNodesFromToolbar,
      loadGraph: loadGraphFromToolbar
    })
  }, [
    setSaveRef,
    saveAllNodes,
    getEdgesSnapshot,
    setNodesFromToolbar,
    loadGraphFromToolbar
  ])

  const removeNode = useCallback((id: string) => {
    if (!canEditRef.current) return
    const store = useWorkflowStore.getState()
    const prevLength = store.nodes.length
    store.removeNode(id)
    const nextLength = useWorkflowStore.getState().nodes.length
    if (nextLength !== prevLength) {
      markWorkflowDirtyRef.current()
    }
  }, [])

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      trigger: (props: NodeProps<FlowNode>) => (
        <TriggerNode
          key={`trigger-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          onRemove={removeNode}
          onChange={handleNodeChange}
          markDirty={markStoreDirty}
          onRun={() => invokeRunWorkflow()}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
        />
      ),
      action: (props: NodeProps<FlowNode>) => (
        <ActionNode
          key={`action-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          onRemove={removeNode}
          onChange={handleNodeChange}
          markDirty={markStoreDirty}
          onRun={() => invokeRunWorkflow()}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
        />
      ),
      condition: (props: NodeProps<FlowNode>) => (
        <ConditionNode
          key={`condition-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          onRemove={removeNode}
          onChange={handleNodeChange}
          markDirty={markStoreDirty}
          onRun={() => console.log('Run Condition', props.id)}
        />
      )
    }),
    [
      removeNode,
      handleNodeChange,
      invokeRunWorkflow,
      normalizedPlanTier,
      onRestrictionNotice,
      markStoreDirty
    ]
  )

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    if (!canEditRef.current || changes.length === 0) return
    const store = useWorkflowStore.getState()
    if (store.locked) return
    const nextNodes = applyNodeChanges(changes, store.nodes)
    const sameLength = nextNodes.length === store.nodes.length
    const sameReference =
      sameLength &&
      nextNodes.every((node, index) => node === store.nodes[index])
    if (sameReference) return
    store.setNodes(nextNodes)
    markWorkflowDirtyRef.current()
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    if (!canEditRef.current || changes.length === 0) return
    const store = useWorkflowStore.getState()
    if (store.locked) return
    const nextEdges = applyEdgeChanges(changes, store.edges)
    const sameLength = nextEdges.length === store.edges.length
    const sameReference =
      sameLength &&
      nextEdges.every((edge, index) => edge === store.edges[index])
    if (sameReference) return
    store.setEdges(nextEdges)
    markWorkflowDirtyRef.current()
  }, [])

  const onConnect = useCallback((params: Connection) => {
    if (!canEditRef.current) return
    const outcomeLabel =
      params?.sourceHandle === 'cond-true'
        ? 'True'
        : params?.sourceHandle === 'cond-false'
          ? 'False'
          : null
    const store = useWorkflowStore.getState()
    if (store.locked) return
    const nextEdges = addEdge(
      {
        ...params,
        type: 'nodeEdge',
        label: outcomeLabel,
        data: {
          edgeType: 'default',
          outcome: outcomeLabel?.toLowerCase?.()
        }
      },
      store.edges
    )
    store.setEdges(nextEdges)
    markWorkflowDirtyRef.current()
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (!canEditRef.current) return
      const type = event.dataTransfer.getData('application/reactflow')
      if (!type) return
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      })
      const store = useWorkflowStore.getState()
      if (isSoloPlan && store.nodes.length >= 10) {
        onRestrictionNotice?.(
          'Solo plan workflows support up to 10 nodes. Upgrade in Settings → Plan to add more steps.'
        )
        return
      }
      const label = generateUniqueLabel(type, store.nodes)
      const newNode: FlowNode = {
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
      const { nodes: nextNodes } = reconcileNodeLabels([
        ...store.nodes,
        newNode
      ])
      store.setNodes(nextNodes)
      markWorkflowDirtyRef.current()
    },
    [isSoloPlan, onRestrictionNotice, reactFlow]
  )

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleEdgeTypeChange = useCallback(
    (edgeId: string, newType: EdgeStyleVariant) => {
      if (!canEditRef.current) return
      const store = useWorkflowStore.getState()
      const target = store.edges.find((edge) => edge.id === edgeId)
      if (!target) return
      const currentType = (target.data as any)?.edgeType ?? 'default'
      if (currentType === newType) return
      const nextEdge: FlowEdge = {
        ...target,
        data: { ...(target.data ?? {}), edgeType: newType }
      }
      store.updateEdge(edgeId, nextEdge)
      markWorkflowDirtyRef.current()
    },
    []
  )

  const handleEdgeDelete = useCallback((edgeId: string) => {
    if (!canEditRef.current) return
    const store = useWorkflowStore.getState()
    const prevLength = store.edges.length
    store.removeEdge(edgeId)
    const nextLength = useWorkflowStore.getState().edges.length
    if (nextLength !== prevLength) {
      markWorkflowDirtyRef.current()
    }
  }, [])

  const edgeTypes = useMemo(
    () =>
      ({
        nodeEdge: (edgeProps: EdgeProps<FlowEdge>) => (
          <NodeEdge
            {...edgeProps}
            onDelete={handleEdgeDelete}
            onChangeType={handleEdgeTypeChange}
          />
        )
      }) satisfies EdgeTypes,
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
      onInit={handleInit}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onDrop={onDrop}
      onDragOver={onDragOver}
      fitView
      proOptions={{ hideAttribution: true }}
      nodesDraggable={canEdit}
      nodesConnectable={canEdit}
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

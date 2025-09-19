import { useCallback, useMemo, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState
} from '@xyflow/react'
import ManualTriggerNode from '@/components/workflow/ManualTrigger'
import { ActionNode } from '@/components/workflow/ActionNode'
import { ConditionNode } from '@/components/workflow/ConditionNode'

export default function FlowCanvas({ markWorkflowDirty, setSaveRef }) {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState([])
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState([])

  const updateNodeData = useCallback(
    (id, newData, suppressDirty = false) => {
      setNodes(nds =>
        nds.map(n =>
          n.id === id
            ? { ...n, data: { ...n.data, ...newData } }
            : n
        )
      )
      if (!suppressDirty) markWorkflowDirty()
    },
    [setNodes, markWorkflowDirty]
  )

  const saveAllNodes = useCallback(() => {
    return nodes.map(n => {
      const hasDuplicateKeys =
        n.data?.inputs?.map(i => i.key.trim()).filter(k => k).length !==
        new Set(n.data?.inputs?.map(i => i.key.trim()).filter(k => k)).size

      const hasInvalidInputs = n.data?.inputs?.some(i => !i.key.trim() || !i.value.trim())
      const newDirty = hasDuplicateKeys || hasInvalidInputs

      return { ...n, data: { ...n.data, dirty: newDirty } }
    })
  }, [nodes])

  useEffect(() => {
    if (setSaveRef) {
      setSaveRef({
        saveAllNodes,
        getEdges: () => edges,
        setNodesFromToolbar: (updatedNodes) => setNodes(nds =>
          nds.map(n => {
            const updated = updatedNodes.find(u => u.id === n.id)
            return updated ? { ...n, data: { ...n.data, ...updated.data } } : n
          })
        )
      })
    }
  }, [edges, saveAllNodes, setSaveRef])

  const removeNode = useCallback(
    id => {
      setNodes(nds => nds.filter(n => n.id !== id))
      markWorkflowDirty()
    },
    [setNodes, markWorkflowDirty]
  )

  const nodeTypes = useMemo(() => ({
    trigger: props => (
      <ManualTriggerNode
        {...props}
        onRemove={removeNode}
        onDirtyChange={markWorkflowDirty}
        onUpdateNode={updateNodeData}
      />
    ),
    action: ActionNode,
    condition: ConditionNode
  }), [removeNode, markWorkflowDirty, updateNodeData])

  const onNodesChange = useCallback(changes => {
    markWorkflowDirty()
    onNodesChangeInternal(changes)
  }, [onNodesChangeInternal, markWorkflowDirty])

  const onEdgesChange = useCallback(changes => {
    markWorkflowDirty()
    onEdgesChangeInternal(changes)
  }, [onEdgesChangeInternal, markWorkflowDirty])

  const onConnect = useCallback(params => {
    markWorkflowDirty()
    setEdges(eds => addEdge(params, eds))
  }, [setEdges, markWorkflowDirty])

  const onDrop = useCallback(event => {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/reactflow')
    if (!type) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const position = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }

    const newNode = {
      id: `${type}-${+new Date()}`,
      type: type.toLowerCase(),
      position,
      data: { label: type, expanded: type.toLowerCase() === 'trigger', dirty: true, inputs: [] }
    }

    setNodes(nds => [...nds, newNode])
    markWorkflowDirty()
  }, [setNodes, markWorkflowDirty])

  const onDragOver = useCallback(event => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      onDrop={onDrop}
      onDragOver={onDragOver}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} size={1} />
      <MiniMap />
      <Controls />
    </ReactFlow>
  )
}

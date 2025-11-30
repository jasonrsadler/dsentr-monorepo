import { describe, expect, it, afterEach } from 'vitest'
import type { Edge, Node } from '@xyflow/react'

import {
  selectEdges,
  selectIsDirty,
  selectIsSaving,
  selectNodes,
  useWorkflowStore
} from '../../src/stores/workflowStore'

const resetStore = () => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    isDirty: false,
    isSaving: false
  })
}

afterEach(() => {
  resetStore()
})

describe('workflowStore', () => {
  const baseNode: Node = {
    id: 'node-1',
    type: 'test',
    position: { x: 0, y: 0 },
    data: { label: 'Initial' }
  }

  const baseEdge: Edge = {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2'
  }

  it('replaces nodes via setNodes and marks state dirty', () => {
    const nodes: Node[] = [baseNode]

    useWorkflowStore.getState().setNodes(nodes)

    expect(selectNodes(useWorkflowStore.getState())).toEqual(nodes)
    expect(selectIsDirty(useWorkflowStore.getState())).toBe(true)
  })

  it('replaces edges via setEdges and marks state dirty', () => {
    const edges: Edge[] = [baseEdge]

    useWorkflowStore.getState().setEdges(edges)

    expect(selectEdges(useWorkflowStore.getState())).toEqual(edges)
    expect(selectIsDirty(useWorkflowStore.getState())).toBe(true)
  })

  it('updates node data shallowly and marks state dirty', () => {
    useWorkflowStore.getState().setNodes([baseNode])

    useWorkflowStore.getState().updateNodeData('node-1', {
      label: 'Updated',
      extra: 'value'
    })

    const [node] = selectNodes(useWorkflowStore.getState())
    expect(node.data).toEqual({ label: 'Updated', extra: 'value' })
    expect(selectIsDirty(useWorkflowStore.getState())).toBe(true)
  })

  it('ignores updateNodeData when node is missing', () => {
    useWorkflowStore.getState().setNodes([baseNode])

    useWorkflowStore.getState().updateNodeData('missing', { foo: 'bar' })

    const [node] = selectNodes(useWorkflowStore.getState())
    expect(node.data).toEqual(baseNode.data)
  })

  it('toggles dirty and saving flags', () => {
    useWorkflowStore.getState().setNodes([baseNode])
    expect(selectIsDirty(useWorkflowStore.getState())).toBe(true)

    useWorkflowStore.getState().markClean()
    expect(selectIsDirty(useWorkflowStore.getState())).toBe(false)

    useWorkflowStore.getState().setSaving(true)
    expect(selectIsSaving(useWorkflowStore.getState())).toBe(true)
  })

  it('provides cloned graph data from getGraph', () => {
    const node: Node = {
      ...baseNode,
      id: 'node-graph'
    }
    const edge: Edge = {
      ...baseEdge,
      id: 'edge-graph',
      source: 'node-graph'
    }

    useWorkflowStore.getState().setNodes([node])
    useWorkflowStore.getState().setEdges([edge])

    const graph = useWorkflowStore.getState().getGraph()
    graph.nodes[0].data = { mutated: true }
    graph.edges.push({ ...edge, id: 'edge-2' })

    const state = useWorkflowStore.getState()
    expect(selectNodes(state)[0].data).toEqual(node.data)
    expect(selectEdges(state)).toHaveLength(1)
  })
})

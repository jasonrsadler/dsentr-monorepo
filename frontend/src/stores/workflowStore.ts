import { create } from 'zustand'
import type { Edge, Node } from '@xyflow/react'

type Graph = {
  nodes: Node[]
  edges: Edge[]
}

export interface WorkflowState {
  nodes: Node[]
  edges: Edge[]
  isDirty: boolean
  isSaving: boolean
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  updateNodeData: (id: string, data: unknown) => void
  markClean: () => void
  setSaving: (flag: boolean) => void
  getGraph: () => Graph
}

const clone = <T>(value: T): T => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value))
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  isDirty: false,
  isSaving: false,
  setNodes: (nodes) => set({ nodes: [...nodes], isDirty: true }),
  setEdges: (edges) => set({ edges: [...edges], isDirty: true }),
  updateNodeData: (id, data) =>
    set((state) => {
      const index = state.nodes.findIndex((node) => node.id === id)
      if (index === -1) {
        return state
      }
      const nextNodes = state.nodes.map((node, nodeIndex) => {
        if (nodeIndex !== index) {
          return node
        }

        if (data === null || typeof data !== 'object') {
          return {
            ...node,
            data
          }
        }

        const currentData =
          node.data !== null && typeof node.data === 'object' ? node.data : {}

        return {
          ...node,
          data: {
            ...currentData,
            ...data
          }
        }
      })

      return {
        nodes: nextNodes,
        isDirty: true
      }
    }),
  markClean: () => set({ isDirty: false }),
  setSaving: (flag) => set({ isSaving: flag }),
  getGraph: () => {
    const { nodes, edges } = get()

    return {
      nodes: clone(nodes),
      edges: clone(edges)
    }
  }
}))

export const selectNodes = (state: WorkflowState) => state.nodes
export const selectEdges = (state: WorkflowState) => state.edges
export const selectIsDirty = (state: WorkflowState) => state.isDirty
export const selectIsSaving = (state: WorkflowState) => state.isSaving

import { create } from 'zustand'
import type { Edge, Node } from '@xyflow/react'
import {
  reconcileNodeLabels,
  shallowEqualData,
  sanitizeNodeData,
  normalizeEdgeForPayload,
  type FlowNode
} from '@/lib/workflowGraph'

type Graph = {
  nodes: Node[]
  edges: Edge[]
}

export interface WorkflowState {
  nodes: Node[]
  edges: Edge[]
  isDirty: boolean
  isSaving: boolean
  canEdit: boolean
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  // Atomically replace the graph and control dirty flag
  setGraph: (nodes: Node[], edges: Edge[], markDirty: boolean) => void
  updateNodeData: (id: string, data: unknown) => void
  removeNode: (id: string) => void
  setCanEdit: (flag: boolean) => void
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
  canEdit: true,
  setNodes: (nodes) =>
    set((state) => {
      // Only mark dirty if the serialized graph (what we save) actually changes
      const prevSanitized = [...state.nodes]
        .map(sanitizeNodeData)
        .sort((a, b) => a.id.localeCompare(b.id))
      const nextSanitized = [...nodes]
        .map(sanitizeNodeData)
        .sort((a, b) => a.id.localeCompare(b.id))
      const changed = JSON.stringify(prevSanitized) !== JSON.stringify(nextSanitized)
      return { nodes: [...nodes], isDirty: state.isDirty || changed }
    }),
  setEdges: (edges) =>
    set((state) => {
      const prevNorm = [...state.edges]
        .map(normalizeEdgeForPayload)
        .sort((a, b) => a.id.localeCompare(b.id))
      const nextNorm = [...edges]
        .map(normalizeEdgeForPayload)
        .sort((a, b) => a.id.localeCompare(b.id))
      const changed = JSON.stringify(prevNorm) !== JSON.stringify(nextNorm)
      return { edges: [...edges], isDirty: state.isDirty || changed }
    }),
  setGraph: (nodes, edges, markDirty) =>
    set(() => ({ nodes: [...nodes], edges: [...edges], isDirty: !!markDirty })),
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
          if (node.data === data) {
            return node
          }

          return {
            ...node,
            data
          }
        }

        const currentData =
          node.data !== null && typeof node.data === 'object' ? node.data : {}
        const mergedData = { ...currentData, ...(data as Record<string, any>) }

        if (shallowEqualData(currentData, mergedData)) {
          return node
        }

        return {
          ...node,
          data: mergedData
        }
      })

      const reconciledNodes = reconcileNodeLabels(nextNodes as FlowNode[])

      if (reconciledNodes === state.nodes) {
        return state
      }

      const prevSanitized = [...state.nodes]
        .map(sanitizeNodeData)
        .sort((a, b) => a.id.localeCompare(b.id))
      const nextSanitized = [...(reconciledNodes as any[])]
        .map(sanitizeNodeData)
        .sort((a, b) => a.id.localeCompare(b.id))
      const changed = JSON.stringify(prevSanitized) !== JSON.stringify(nextSanitized)
      return changed
        ? {
            nodes: reconciledNodes,
            isDirty: true
          }
        : state
    }),
  removeNode: (id) =>
    set((state) => {
      const nextNodes = state.nodes.filter((node) => node.id !== id)
      if (nextNodes.length === state.nodes.length) {
        return state
      }

      const nextEdges = state.edges.filter(
        (edge) => edge.source !== id && edge.target !== id
      )

      return {
        nodes: nextNodes,
        edges: nextEdges,
        isDirty: true
      }
    }),
  setCanEdit: (flag) => set({ canEdit: flag }),
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

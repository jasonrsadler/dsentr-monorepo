import { create } from 'zustand'
import type { Edge, Node } from '@xyflow/react'

export type FlowNode = Node<Record<string, unknown>>
export type FlowEdge = Edge<Record<string, unknown>>

type ArrayUpdater<T> = T[] | ((previous: T[]) => T[])

type NodeStatusMap = Record<string, true>

type NodeStatusState = {
  running: NodeStatusMap
  succeeded: NodeStatusMap
  failed: NodeStatusMap
}

type WorkflowState = {
  workflowId: string | null
  nodes: FlowNode[]
  edges: FlowEdge[]
  isDirty: boolean
  locked: boolean
  nodeStatus: NodeStatusState
  lock: () => void
  unlock: () => void
  clearDirty: () => void
  setNodes: (
    updater: ArrayUpdater<FlowNode>,
    options?: { markDirty?: boolean }
  ) => void
  setEdges: (
    updater: ArrayUpdater<FlowEdge>,
    options?: { markDirty?: boolean }
  ) => void
  updateNode: (
    id: string,
    updater: ((node: FlowNode) => FlowNode) | FlowNode
  ) => void
  updateEdge: (
    id: string,
    updater: ((edge: FlowEdge) => FlowEdge) | FlowEdge
  ) => void
  removeNode: (id: string) => void
  removeEdge: (id: string) => void
  replaceGraph: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    options?: { markDirty?: boolean }
  ) => void
  markDirty: () => void
  mergeNodeData: (
    id: string,
    data: Record<string, unknown>,
    options?: { markDirty?: boolean; reconcileLabels?: boolean }
  ) => boolean
  setNodeStatuses: (
    running?: Iterable<string> | null,
    succeeded?: Iterable<string> | null,
    failed?: Iterable<string> | null
  ) => void
  loadWorkflow: (payload: {
    workflowId: string | null
    nodes?: FlowNode[]
    edges?: FlowEdge[]
  }) => void
}

export const LABEL_MESSAGES = {
  spaces: 'Node names cannot contain spaces.',
  duplicate: 'Node name must be unique.'
} as const

export function sanitizeLabelInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function countExistingLabels(nodes: FlowNode[]): Map<string, number> {
  const counts = new Map<string, number>()
  nodes.forEach((node) => {
    const label = sanitizeLabelInput(node?.data?.label)
    if (!label) return
    const key = label.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return counts
}

export function generateUniqueLabel(
  baseLabel: string,
  nodes: FlowNode[]
): string {
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

function resolveUpdater<T>(updater: ArrayUpdater<T>, previous: T[]): T[] {
  const result = typeof updater === 'function' ? updater(previous) : updater
  return [...result]
}

function shallowEqualRecord(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): boolean {
  if (!previous) {
    return Object.keys(next).length === 0
  }
  const prevKeys = Object.keys(previous)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) {
    return false
  }
  for (const key of nextKeys) {
    if (previous[key] !== next[key]) {
      return false
    }
  }
  return true
}

function toStatusMap(
  iterable: Iterable<string> | null | undefined
): NodeStatusMap {
  const map: NodeStatusMap = {}
  if (!iterable) {
    return map
  }
  for (const value of iterable) {
    if (typeof value === 'string' && value) {
      map[value] = true
    }
  }
  return map
}

function statusMapsEqual(a: NodeStatusMap, b: NodeStatusMap): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) {
    return false
  }
  for (const key of keysA) {
    if (!b[key]) {
      return false
    }
  }
  return true
}

export function reconcileNodeLabels(nodes: FlowNode[]): {
  nodes: FlowNode[]
  changed: boolean
} {
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

    if (!nextDataShouldChange) {
      return node
    }
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
  return { nodes: nextNodes, changed: hasChanges }
}

function removeFromStatusMap(map: NodeStatusMap, id: string): NodeStatusMap {
  if (!map[id]) {
    return map
  }
  const next = { ...map }
  delete next[id]
  return next
}

function withDirty(
  state: WorkflowState,
  next: Partial<WorkflowState>,
  markDirty: boolean | undefined
): WorkflowState {
  const baseState = { ...state, ...next }
  if (markDirty === true && !state.isDirty) {
    return { ...baseState, isDirty: true }
  }
  return baseState
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflowId: null,
  nodes: [],
  edges: [],
  isDirty: false,
  locked: false,
  nodeStatus: {
    running: {},
    succeeded: {},
    failed: {}
  },
  lock: () =>
    set((state) => (state.locked ? state : { ...state, locked: true })),
  unlock: () =>
    set((state) => (state.locked ? { ...state, locked: false } : state)),
  clearDirty: () =>
    set((state) => (state.isDirty ? { ...state, isDirty: false } : state)),
  setNodes: (updater, options) =>
    set((state) => {
      const markDirty = options?.markDirty ?? true
      if (state.locked && markDirty) {
        return state
      }
      const nextNodes = resolveUpdater(updater, state.nodes)
      if (
        nextNodes.length === state.nodes.length &&
        nextNodes.every((n, index) => n === state.nodes[index])
      ) {
        return state
      }
      return withDirty(state, { nodes: nextNodes }, markDirty)
    }),
  setEdges: (updater, options) =>
    set((state) => {
      const markDirty = options?.markDirty ?? true
      if (state.locked && markDirty) {
        return state
      }
      const nextEdges = resolveUpdater(updater, state.edges)
      if (
        nextEdges.length === state.edges.length &&
        nextEdges.every((e, index) => e === state.edges[index])
      ) {
        return state
      }
      return withDirty(state, { edges: nextEdges }, markDirty)
    }),
  updateNode: (id, updater) =>
    set((state) => {
      const markDirty = true
      if (state.locked && markDirty) {
        return state
      }
      let changed = false
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== id) {
          return node
        }
        changed = true
        const updated = typeof updater === 'function' ? updater(node) : updater
        return { ...updated }
      })
      if (!changed) {
        return state
      }
      return withDirty(state, { nodes: nextNodes }, markDirty)
    }),
  updateEdge: (id, updater) =>
    set((state) => {
      const markDirty = true
      if (state.locked && markDirty) {
        return state
      }
      let changed = false
      const nextEdges = state.edges.map((edge) => {
        if (edge.id !== id) {
          return edge
        }
        changed = true
        const updated = typeof updater === 'function' ? updater(edge) : updater
        return { ...updated }
      })
      if (!changed) {
        return state
      }
      return withDirty(state, { edges: nextEdges }, markDirty)
    }),
  removeNode: (id) =>
    set((state) => {
      const markDirty = true
      if (state.locked && markDirty) {
        return state
      }
      const nextNodes = state.nodes.filter((node) => node.id !== id)
      if (nextNodes.length === state.nodes.length) {
        return state
      }
      const nextEdges = state.edges.filter(
        (edge) => edge.source !== id && edge.target !== id
      )
      const currentStatuses = state.nodeStatus
      const nextStatuses: NodeStatusState = {
        running: removeFromStatusMap(currentStatuses.running, id),
        succeeded: removeFromStatusMap(currentStatuses.succeeded, id),
        failed: removeFromStatusMap(currentStatuses.failed, id)
      }
      const nextState: Partial<WorkflowState> = {
        nodes: nextNodes,
        edges: nextEdges,
        nodeStatus: nextStatuses
      }
      return withDirty(state, nextState, markDirty)
    }),
  removeEdge: (id) =>
    set((state) => {
      const markDirty = true
      if (state.locked && markDirty) {
        return state
      }
      const nextEdges = state.edges.filter((edge) => edge.id !== id)
      if (nextEdges.length === state.edges.length) {
        return state
      }
      return withDirty(state, { edges: nextEdges }, markDirty)
    }),
  replaceGraph: (nodes, edges, options) =>
    set((state) => {
      const markDirty = options?.markDirty ?? true
      if (state.locked && markDirty) {
        return state
      }
      return withDirty(
        state,
        {
          nodes: [...nodes],
          edges: [...edges],
          nodeStatus: {
            running: {},
            succeeded: {},
            failed: {}
          }
        },
        markDirty
      )
    }),
  markDirty: () =>
    set((state) => {
      if (state.locked || state.isDirty) {
        return state
      }
      return { ...state, isDirty: true }
    }),
  mergeNodeData: (id, data, options) => {
    const { markDirty = true, reconcileLabels = true } = options ?? {}
    let didChange = false
    set((state) => {
      if (state.locked && markDirty) {
        return state
      }
      let nodeChanged = false
      const nextNodes = state.nodes.map((node) => {
        if (node.id !== id) {
          return node
        }
        const previousData = (node.data ?? {}) as Record<string, unknown>
        const mergedData = { ...previousData, ...data }
        if (shallowEqualRecord(previousData, mergedData)) {
          return node
        }
        nodeChanged = true
        return { ...node, data: mergedData }
      })

      if (!nodeChanged) {
        return state
      }

      const reconciled = reconcileLabels
        ? reconcileNodeLabels(nextNodes)
        : { nodes: nextNodes, changed: false }
      const finalNodes = reconciled.changed ? reconciled.nodes : nextNodes
      didChange = true
      return withDirty(
        state,
        {
          nodes: finalNodes
        },
        markDirty
      )
    })
    return didChange
  },
  setNodeStatuses: (running, succeeded, failed) =>
    set((state) => {
      const previous = state.nodeStatus
      const nextRunning =
        running === undefined
          ? previous.running
          : (() => {
              const candidate = toStatusMap(running)
              return statusMapsEqual(candidate, previous.running)
                ? previous.running
                : candidate
            })()
      const nextSucceeded =
        succeeded === undefined
          ? previous.succeeded
          : (() => {
              const candidate = toStatusMap(succeeded)
              return statusMapsEqual(candidate, previous.succeeded)
                ? previous.succeeded
                : candidate
            })()
      const nextFailed =
        failed === undefined
          ? previous.failed
          : (() => {
              const candidate = toStatusMap(failed)
              return statusMapsEqual(candidate, previous.failed)
                ? previous.failed
                : candidate
            })()

      if (
        nextRunning === previous.running &&
        nextSucceeded === previous.succeeded &&
        nextFailed === previous.failed
      ) {
        return state
      }

      return {
        ...state,
        nodeStatus: {
          running: nextRunning,
          succeeded: nextSucceeded,
          failed: nextFailed
        }
      }
    }),
  loadWorkflow: ({ workflowId, nodes = [], edges = [] }) =>
    set((state) => ({
      workflowId,
      nodes: [...nodes],
      edges: [...edges],
      isDirty: false,
      locked: state.locked,
      nodeStatus: {
        running: {},
        succeeded: {},
        failed: {}
      }
    }))
}))

export const selectNodeData =
  <T = Record<string, unknown>>(id: string) =>
  (state: WorkflowState) =>
    state.nodes.find((candidate) => candidate.id === id)?.data as T | undefined

export const selectNodeSelected = (id: string) => (state: WorkflowState) =>
  Boolean(state.nodes.find((candidate) => candidate.id === id)?.selected)

export const selectNodeStatus = (id: string) => {
  let lastRunning: boolean | undefined
  let lastSucceeded: boolean | undefined
  let lastFailed: boolean | undefined
  let cachedSnapshot = {
    isRunning: false,
    isSucceeded: false,
    isFailed: false
  }

  return (state: WorkflowState) => {
    const statuses = state.nodeStatus
    const nextRunning = Boolean(statuses.running[id])
    const nextSucceeded = Boolean(statuses.succeeded[id])
    const nextFailed = Boolean(statuses.failed[id])

    if (
      cachedSnapshot &&
      nextRunning === lastRunning &&
      nextSucceeded === lastSucceeded &&
      nextFailed === lastFailed
    ) {
      return cachedSnapshot
    }

    lastRunning = nextRunning
    lastSucceeded = nextSucceeded
    lastFailed = nextFailed
    cachedSnapshot = {
      isRunning: nextRunning,
      isSucceeded: nextSucceeded,
      isFailed: nextFailed
    }
    return cachedSnapshot
  }
}

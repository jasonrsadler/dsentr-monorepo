import { normalizeEdge, reconcileNodeLabels } from '@/lib/workflowGraph'

const ACTION_NODE_TYPE_ALIASES: Record<string, string> = {
  'action.email': 'actionEmail',
  actionemail: 'actionEmail',
  email: 'actionEmail',
  'action.webhook': 'actionWebhook',
  actionwebhook: 'actionWebhook',
  webhook: 'actionWebhook',
  'action.messaging.slack': 'actionSlack',
  actionslack: 'actionSlack',
  slack: 'actionSlack',
  'action.messaging.teams': 'actionTeams',
  actionteams: 'actionTeams',
  teams: 'actionTeams',
  'action.googlechat': 'actionGoogleChat',
  actiongooglechat: 'actionGoogleChat',
  googlechat: 'actionGoogleChat',
  'google chat': 'actionGoogleChat',
  'action.sheets': 'actionSheets',
  actionsheets: 'actionSheets',
  sheets: 'actionSheets',
  'action.http': 'actionHttp',
  actionhttp: 'actionHttp',
  http: 'actionHttp',
  'action.code': 'actionCode',
  actioncode: 'actionCode',
  code: 'actionCode'
}

function normalizeNodeType(nodeType: unknown): string | undefined {
  if (typeof nodeType !== 'string') {
    return undefined
  }
  const trimmed = nodeType.trim()
  if (!trimmed) return trimmed
  const lowered = trimmed.toLowerCase()
  return ACTION_NODE_TYPE_ALIASES[lowered] ?? trimmed
}

export function cloneWorkflowData<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value))
}

export function normalizeEdgesForState(edges: any[]) {
  return edges.map((edge: any) => {
    const normalized = normalizeEdge(edge)
    return {
      ...normalized,
      // Preserve selection state so edge UI depending on `selected` works
      selected: Boolean((edge as any)?.selected),
      data:
        normalized?.data && typeof normalized.data === 'object'
          ? cloneWorkflowData(normalized.data)
          : normalized.data
    }
  })
}

export function normalizeNodesForState(nodes: any[]) {
  return reconcileNodeLabels(
    nodes.map((node: any) => ({
      ...node,
      type: normalizeNodeType(node?.type),
      data:
        node?.data && typeof node.data === 'object'
          ? cloneWorkflowData(node.data)
          : node.data
    }))
  )
}

export function hydrateIncomingNodes(rawNodes: any[], epoch: number) {
  return rawNodes.map((node: any) => ({
    id: node.id,
    type: normalizeNodeType(node.type),
    position: node.position,
    data: {
      ...(node?.data ? cloneWorkflowData(node.data) : {}),
      dirty: Boolean(node?.data?.dirty),
      wfEpoch: epoch
    }
  }))
}

export function hydrateIncomingEdges(rawEdges: any[]) {
  return normalizeEdgesForState(rawEdges)
}

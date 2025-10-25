import { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type OnSelectionChangeParams
} from '@xyflow/react'
import TriggerNode from '@/components/Workflow/TriggerNode'
import {
  SendGridActionNode,
  MailgunActionNode,
  AmazonSesActionNode,
  SmtpActionNode,
  WebhookActionNode,
  SlackActionNode,
  TeamsActionNode,
  GoogleChatActionNode,
  GoogleSheetsActionNode,
  HttpRequestActionNode,
  RunCustomCodeActionNode
} from '@/components/workflow/nodes'
import NodeEdge from '@/components/Workflow/NodeEdge'
import CustomControls from '@/components/UI/ReactFlow/CustomControl'
import ConditionNode from '@/components/Workflow/ConditionNode'
import { normalizePlanTier } from '@/lib/planTiers'
import { generateUniqueLabel } from '@/lib/workflowGraph'
import {
  useWorkflowStore,
  selectNodes,
  selectEdges
} from '@/stores/workflowStore'
import {
  normalizeEdgesForState,
  normalizeNodesForState
} from './FlowCanvas.helpers'
import { WorkflowFlyoutProvider } from '@/components/workflow/useWorkflowFlyout'

type ActionDropSubtype =
  | 'actionEmailSendgrid'
  | 'actionEmailMailgun'
  | 'actionEmailAmazonSes'
  | 'actionEmailSmtp'
  | 'actionWebhook'
  | 'actionSlack'
  | 'actionTeams'
  | 'actionGoogleChat'
  | 'actionSheets'
  | 'actionHttp'
  | 'actionCode'

interface DropDescriptor {
  nodeType: string
  labelBase: string
  idPrefix: string
  expanded: boolean
  data: Record<string, unknown>
}

type ActionDropConfig = {
  nodeType: ActionDropSubtype
  labelBase: string
  idPrefix: string
  expanded: boolean
  createData: () => Record<string, unknown>
}

const ACTION_NODE_DROP_CONFIG: Record<ActionDropSubtype, ActionDropConfig> = {
  actionEmailSendgrid: {
    nodeType: 'actionEmailSendgrid',
    labelBase: 'SendGrid email',
    idPrefix: 'action-email-sendgrid',
    expanded: true,
    createData: () => ({
      actionType: 'email',
      emailProvider: 'sendgrid',
      params: {
        apiKey: '',
        from: '',
        to: '',
        templateId: '',
        substitutions: [],
        subject: '',
        body: ''
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionEmailMailgun: {
    nodeType: 'actionEmailMailgun',
    labelBase: 'Mailgun email',
    idPrefix: 'action-email-mailgun',
    expanded: true,
    createData: () => ({
      actionType: 'email',
      emailProvider: 'mailgun',
      params: {
        domain: '',
        apiKey: '',
        region: 'US (api.mailgun.net)',
        from: '',
        to: '',
        subject: '',
        body: '',
        template: '',
        variables: []
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionEmailAmazonSes: {
    nodeType: 'actionEmailAmazonSes',
    labelBase: 'Amazon SES email',
    idPrefix: 'action-email-amazon-ses',
    expanded: true,
    createData: () => ({
      actionType: 'email',
      emailProvider: 'amazon_ses',
      params: {
        awsAccessKey: '',
        awsSecretKey: '',
        awsRegion: 'us-east-1',
        sesVersion: 'v2',
        fromEmail: '',
        toEmail: '',
        subject: '',
        body: '',
        template: '',
        templateVariables: []
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionEmailSmtp: {
    nodeType: 'actionEmailSmtp',
    labelBase: 'SMTP email',
    idPrefix: 'action-email-smtp',
    expanded: true,
    createData: () => ({
      actionType: 'email',
      emailProvider: 'smtp',
      params: {
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPassword: '',
        smtpTlsMode: 'starttls',
        smtpTls: true,
        from: '',
        to: '',
        subject: '',
        body: ''
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionWebhook: {
    nodeType: 'actionWebhook',
    labelBase: 'Webhook call',
    idPrefix: 'action-webhook',
    expanded: true,
    createData: () => ({
      actionType: 'webhook',
      params: {
        method: 'POST',
        url: '',
        headers: [],
        queryParams: [],
        bodyType: 'raw',
        body: '',
        formBody: [],
        authType: 'none',
        authUsername: '',
        authPassword: '',
        authToken: ''
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionSlack: {
    nodeType: 'actionSlack',
    labelBase: 'Slack message',
    idPrefix: 'action-slack',
    expanded: true,
    createData: () => ({
      actionType: 'slack',
      params: {
        channel: '',
        message: '',
        token: '',
        connectionScope: '',
        connectionId: '',
        accountEmail: ''
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionTeams: {
    nodeType: 'actionTeams',
    labelBase: 'Teams message',
    idPrefix: 'action-teams',
    expanded: true,
    createData: () => ({
      actionType: 'teams',
      params: {
        deliveryMethod: 'Incoming Webhook',
        webhookType: 'Connector',
        webhookUrl: '',
        message: '',
        summary: '',
        title: '',
        themeColor: '',
        oauthProvider: '',
        oauthConnectionScope: '',
        oauthConnectionId: '',
        oauthAccountEmail: '',
        cardJson: '',
        cardMode: 'Simple card builder',
        cardTitle: '',
        cardBody: '',
        workflowOption: 'Basic (Raw JSON)',
        workflowRawJson: '',
        workflowHeaderName: '',
        workflowHeaderSecret: '',
        teamId: '',
        teamName: '',
        channelId: '',
        channelName: '',
        messageType: 'Text',
        mentions: []
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionGoogleChat: {
    nodeType: 'actionGoogleChat',
    labelBase: 'Google Chat message',
    idPrefix: 'action-google-chat',
    expanded: true,
    createData: () => ({
      actionType: 'googlechat',
      params: {
        webhookUrl: '',
        message: '',
        cardJson: ''
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionSheets: {
    nodeType: 'actionSheets',
    labelBase: 'Google Sheets row',
    idPrefix: 'action-sheets',
    expanded: true,
    createData: () => ({
      actionType: 'sheets',
      params: {
        spreadsheetId: '',
        worksheet: '',
        columns: [],
        accountEmail: '',
        oauthConnectionScope: '',
        oauthConnectionId: ''
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionHttp: {
    nodeType: 'actionHttp',
    labelBase: 'HTTP request',
    idPrefix: 'action-http',
    expanded: true,
    createData: () => ({
      actionType: 'http',
      params: {
        method: 'GET',
        url: '',
        headers: [],
        queryParams: [],
        bodyType: 'raw',
        body: '',
        formBody: [],
        authType: 'none',
        authUsername: '',
        authPassword: '',
        authToken: ''
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  },
  actionCode: {
    nodeType: 'actionCode',
    labelBase: 'Code step',
    idPrefix: 'action-code',
    expanded: true,
    createData: () => ({
      actionType: 'code',
      params: {
        code: '',
        inputs: [],
        outputs: []
      },
      timeout: 5000,
      retries: 0,
      stopOnError: true
    })
  }
} as const

function normalizeActionDropSubtype(
  rawSubtype?: string | null
): ActionDropSubtype {
  if (!rawSubtype) return 'actionEmailSendgrid'
  const lowered = rawSubtype.trim().toLowerCase()
  switch (lowered) {
    case 'actionemailsendgrid':
    case 'actionemail':
    case 'send email':
    case 'email':
    case 'sendgrid':
      return 'actionEmailSendgrid'
    case 'actionemailmailgun':
    case 'mailgun':
      return 'actionEmailMailgun'
    case 'actionemailamazonses':
    case 'amazon ses':
    case 'amazon_ses':
    case 'amazonses':
      return 'actionEmailAmazonSes'
    case 'actionemailsmtp':
    case 'smtp':
      return 'actionEmailSmtp'
    case 'actionwebhook':
    case 'post webhook':
    case 'webhook':
      return 'actionWebhook'
    case 'actionslack':
    case 'slack':
      return 'actionSlack'
    case 'actionteams':
    case 'teams':
      return 'actionTeams'
    case 'actiongooglechat':
    case 'googlechat':
    case 'google chat':
      return 'actionGoogleChat'
    case 'actionsheets':
    case 'sheets':
    case 'create google sheet row':
      return 'actionSheets'
    case 'actionhttp':
    case 'http':
    case 'http request':
      return 'actionHttp'
    case 'actioncode':
    case 'code':
    case 'run custom code':
      return 'actionCode'
    case 'messaging':
      return 'actionSlack'
    default:
      return 'actionEmailSendgrid'
  }
}

function normalizeDropType(rawType: string): DropDescriptor {
  const [categoryRaw, subtypeRaw] = rawType.split(':')
  const category = categoryRaw?.trim().toLowerCase()

  if (category === 'trigger') {
    return {
      nodeType: 'trigger',
      labelBase: 'Trigger',
      idPrefix: 'trigger',
      expanded: true,
      data: {}
    }
  }

  if (category === 'condition') {
    return {
      nodeType: 'condition',
      labelBase: 'Condition',
      idPrefix: 'condition',
      expanded: true,
      data: {}
    }
  }

  if (category === 'action') {
    const subtype = normalizeActionDropSubtype(subtypeRaw ?? null)
    const config = ACTION_NODE_DROP_CONFIG[subtype]
    return {
      nodeType: config.nodeType,
      labelBase: config.labelBase,
      idPrefix: config.idPrefix,
      expanded: config.expanded,
      data: config.createData()
    }
  }

  const fallback = ACTION_NODE_DROP_CONFIG.actionEmailSendgrid
  return {
    nodeType: fallback.nodeType,
    labelBase: fallback.labelBase,
    idPrefix: fallback.idPrefix,
    expanded: fallback.expanded,
    data: fallback.createData()
  }
}

interface FlowCanvasProps {
  isDark?: boolean
  workflowId?: string | null
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
  workflowId,
  onRunWorkflow,
  runningIds = new Set(),
  succeededIds = new Set(),
  failedIds = new Set(),
  planTier,
  onRestrictionNotice,
  canEdit = true
}: FlowCanvasProps) {
  const nodes = useWorkflowStore(selectNodes)
  const edges = useWorkflowStore(selectEdges)
  const reactFlow = useReactFlow()
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const syncSelectionToStore = useCallback((nextSelectedId: string | null) => {
    const state = useWorkflowStore.getState()
    const currentNodes = state.nodes
    let nodeChanged = false
    const nextNodes = currentNodes.map((node) => {
      const shouldSelect = nextSelectedId !== null && node.id === nextSelectedId
      if (Boolean(node.selected) === shouldSelect) {
        return node
      }
      nodeChanged = true
      return {
        ...node,
        selected: shouldSelect
      }
    })
    if (nodeChanged) {
      state.setNodes(nextNodes)
    }

    const currentEdges = state.edges
    let edgeChanged = false
    const nextEdges = currentEdges.map((edge) => {
      if (!edge.selected) {
        return edge
      }
      edgeChanged = true
      return { ...edge, selected: false }
    })
    if (edgeChanged) {
      state.setEdges(nextEdges)
    }
  }, [])
  const normalizedPlanTier = useMemo(
    () => normalizePlanTier(planTier),
    [planTier]
  )
  const isSoloPlan = normalizedPlanTier === 'solo'
  const canEditRef = useRef<boolean>(canEdit)
  const setCanEditState = useWorkflowStore((state) => state.setCanEdit)

  useEffect(() => {
    canEditRef.current = canEdit
    setCanEditState(canEdit)
  }, [canEdit, setCanEditState])

  const onRunWorkflowRef = useRef(onRunWorkflow)
  useEffect(() => {
    onRunWorkflowRef.current = onRunWorkflow
  }, [onRunWorkflow])

  const invokeRunWorkflow = useCallback(() => {
    onRunWorkflowRef.current?.()
  }, [])

  const { setNodes, setEdges } = useMemo(() => {
    const state = useWorkflowStore.getState()
    return {
      setNodes: state.setNodes,
      setEdges: state.setEdges
    }
  }, [])

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

  const selectedNode = useWorkflowStore(
    useCallback(
      (state) =>
        selectedNodeId
          ? (state.nodes.find((node) => node.id === selectedNodeId) ?? null)
          : null,
      [selectedNodeId]
    )
  )

  useEffect(() => {
    if (selectedNodeId && !selectedNode) {
      syncSelectionToStore(null)
      setSelectedNodeId(null)
    }
  }, [selectedNodeId, selectedNode, syncSelectionToStore])

  const determineActionSubtype = useCallback((data: any): ActionDropSubtype => {
    const rawActionType =
      typeof data?.actionType === 'string' ? data.actionType : null
    const normalizedActionType = (() => {
      if (!rawActionType) return 'email'
      const lowered = rawActionType.trim().toLowerCase()
      switch (lowered) {
        case 'send email':
          return 'email'
        case 'post webhook':
          return 'webhook'
        case 'create google sheet row':
          return 'sheets'
        case 'http request':
          return 'http'
        case 'run custom code':
          return 'code'
        default:
          return lowered || 'email'
      }
    })()

    if (normalizedActionType === 'messaging') {
      const platform =
        typeof data?.params?.platform === 'string'
          ? data.params.platform.trim().toLowerCase()
          : ''
      if (platform === 'google chat' || platform === 'googlechat') {
        return 'actionGoogleChat'
      }
      if (platform === 'teams') return 'actionTeams'
      return 'actionSlack'
    }

    switch (normalizedActionType) {
      case 'email': {
        const providerSource = (() => {
          if (typeof data?.emailProvider === 'string') {
            return data.emailProvider
          }
          if (typeof data?.params?.provider === 'string') {
            return data.params.provider
          }
          if (typeof data?.params?.service === 'string') {
            return data.params.service
          }
          return ''
        })()

        const normalizedProvider = providerSource.trim().toLowerCase()
        if (normalizedProvider.includes('mailgun')) {
          return 'actionEmailMailgun'
        }
        if (
          normalizedProvider === 'amazon ses' ||
          normalizedProvider === 'amazon_ses' ||
          normalizedProvider === 'amazonses'
        ) {
          return 'actionEmailAmazonSes'
        }
        if (normalizedProvider === 'smtp') {
          return 'actionEmailSmtp'
        }
        if (normalizedProvider.includes('sendgrid')) {
          return 'actionEmailSendgrid'
        }

        const paramsRecord =
          data?.params && typeof data.params === 'object'
            ? (data.params as Record<string, unknown>)
            : ({} as Record<string, unknown>)

        if ('smtpHost' in paramsRecord || 'smtpUser' in paramsRecord) {
          return 'actionEmailSmtp'
        }
        if (
          'awsAccessKey' in paramsRecord ||
          'awsSecretKey' in paramsRecord ||
          'sesVersion' in paramsRecord ||
          'awsRegion' in paramsRecord
        ) {
          return 'actionEmailAmazonSes'
        }
        if ('domain' in paramsRecord || 'region' in paramsRecord) {
          return 'actionEmailMailgun'
        }
        return 'actionEmailSendgrid'
      }
      case 'webhook':
        return 'actionWebhook'
      case 'slack':
        return 'actionSlack'
      case 'teams':
        return 'actionTeams'
      case 'googlechat':
        return 'actionGoogleChat'
      case 'sheets':
        return 'actionSheets'
      case 'http':
        return 'actionHttp'
      case 'code':
        return 'actionCode'
      default:
        return 'actionEmailSendgrid'
    }
  }, [])

  const actionRenderers = useMemo(() => {
    const sharedRunProps = {
      onRun: () => invokeRunWorkflow(),
      canEdit
    }

    return {
      actionEmailSendgrid: (props) => (
        <SendGridActionNode
          key={`action-email-sendgrid-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionEmailMailgun: (props) => (
        <MailgunActionNode
          key={`action-email-mailgun-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionEmailAmazonSes: (props) => (
        <AmazonSesActionNode
          key={`action-email-amazon-ses-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionEmailSmtp: (props) => (
        <SmtpActionNode
          key={`action-email-smtp-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionWebhook: (props) => (
        <WebhookActionNode
          key={`action-webhook-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionSlack: (props) => (
        <SlackActionNode
          key={`action-slack-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionTeams: (props) => (
        <TeamsActionNode
          key={`action-teams-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionGoogleChat: (props) => (
        <GoogleChatActionNode
          key={`action-google-chat-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionSheets: (props) => (
        <GoogleSheetsActionNode
          key={`action-sheets-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionHttp: (props) => (
        <HttpRequestActionNode
          key={`action-http-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      ),
      actionCode: (props) => (
        <RunCustomCodeActionNode
          key={`action-code-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          {...sharedRunProps}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
        />
      )
    }
  }, [invokeRunWorkflow, canEdit, normalizedPlanTier, onRestrictionNotice])

  const renderActionNode = useCallback(
    (subtype: keyof typeof actionRenderers, props: any) => {
      const renderer =
        actionRenderers[subtype] ?? actionRenderers.actionEmailSendgrid
      return renderer(props)
    },
    [actionRenderers]
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
          onRun={() => invokeRunWorkflow()}
          planTier={normalizedPlanTier}
          onRestrictionNotice={onRestrictionNotice}
          canEdit={canEdit}
        />
      ),
      condition: (props) => (
        <ConditionNode
          key={`condition-${props.id}-${props?.data?.wfEpoch ?? ''}`}
          {...props}
          isRunning={runningIdsRef.current.has(props.id)}
          isSucceeded={succeededIdsRef.current.has(props.id)}
          isFailed={failedIdsRef.current.has(props.id)}
          canEdit={canEdit}
        />
      ),
      actionEmailSendgrid: (props) =>
        renderActionNode('actionEmailSendgrid', props),
      actionEmailMailgun: (props) =>
        renderActionNode('actionEmailMailgun', props),
      actionEmailAmazonSes: (props) =>
        renderActionNode('actionEmailAmazonSes', props),
      actionEmailSmtp: (props) => renderActionNode('actionEmailSmtp', props),
      actionEmail: (props) => {
        const subtype = determineActionSubtype(props?.data)
        return renderActionNode(subtype as keyof typeof actionRenderers, props)
      },
      actionWebhook: (props) => renderActionNode('actionWebhook', props),
      actionSlack: (props) => renderActionNode('actionSlack', props),
      actionTeams: (props) => renderActionNode('actionTeams', props),
      actionGoogleChat: (props) => renderActionNode('actionGoogleChat', props),
      actionSheets: (props) => renderActionNode('actionSheets', props),
      actionHttp: (props) => renderActionNode('actionHttp', props),
      actionCode: (props) => renderActionNode('actionCode', props),
      action: (props) => {
        const subtype = determineActionSubtype(props?.data)
        return renderActionNode(subtype as keyof typeof actionRenderers, props)
      }
    }),
    [
      canEdit,
      determineActionSubtype,
      invokeRunWorkflow,
      normalizedPlanTier,
      onRestrictionNotice,
      renderActionNode
    ]
  )

  const onNodesChange = useCallback(
    (changes) => {
      if (!canEditRef.current) return
      const currentNodes = useWorkflowStore.getState().nodes
      const nextNodes = applyNodeChanges(changes, currentNodes)
      if (nextNodes === currentNodes) return
      const normalizedNodes = normalizeNodesForState(nextNodes)
      setNodes(normalizedNodes)
    },
    [setNodes]
  )

  const onEdgesChange = useCallback(
    (changes) => {
      if (!canEditRef.current) return
      const currentEdges = useWorkflowStore.getState().edges
      const nextEdges = applyEdgeChanges(changes, currentEdges)
      if (nextEdges === currentEdges) return
      const normalizedEdges = normalizeEdgesForState(nextEdges)
      setEdges(normalizedEdges)
    },
    [setEdges]
  )

  const onConnect = useCallback(
    (params) => {
      if (!canEditRef.current) return
      const outcomeLabel =
        params?.sourceHandle === 'cond-true'
          ? 'True'
          : params?.sourceHandle === 'cond-false'
            ? 'False'
            : null
      const currentEdges = useWorkflowStore.getState().edges
      const withNewEdge = addEdge(
        {
          ...params,
          type: 'nodeEdge',
          label: outcomeLabel,
          data: {
            edgeType: 'default',
            outcome: outcomeLabel?.toLowerCase?.()
          }
        },
        currentEdges
      )
      const normalizedEdges = normalizeEdgesForState(withNewEdge)
      setEdges(normalizedEdges)
    },
    [setEdges]
  )

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      if (!canEditRef.current) return
      const rawType = event.dataTransfer.getData('application/reactflow')
      if (!rawType) return
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      })
      const currentNodes = useWorkflowStore.getState().nodes
      if (isSoloPlan && currentNodes.length >= 10) {
        onRestrictionNotice?.(
          'Solo plan workflows support up to 10 nodes. Upgrade in Settings → Plan to add more steps.'
        )
        return
      }
      const dropDescriptor = normalizeDropType(rawType)
      const label = generateUniqueLabel(dropDescriptor.labelBase, currentNodes)
      const nodeIdPrefix = dropDescriptor.idPrefix.replace(/[^a-z0-9]+/gi, '-')
      const newNodeId = `${nodeIdPrefix}-${Date.now()}`
      const newNode = {
        id: newNodeId,
        type: dropDescriptor.nodeType,
        position,
        data: {
          label,
          expanded: dropDescriptor.expanded,
          dirty: true,
          inputs: [],
          labelError: null,
          hasLabelValidationError: false,
          ...dropDescriptor.data
        }
      }
      const normalizedNodes = normalizeNodesForState([...currentNodes, newNode])
      setNodes(normalizedNodes)
    },
    [setNodes, isSoloPlan, onRestrictionNotice, reactFlow]
  )

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      const lastSelected =
        selectedNodes && selectedNodes.length > 0
          ? selectedNodes[selectedNodes.length - 1]
          : null
      const nextId = lastSelected?.id ?? null
      syncSelectionToStore(nextId)
      setSelectedNodeId((prev) => (prev === nextId ? prev : nextId))
    },
    [syncSelectionToStore]
  )

  const handleFlyoutOpen = useCallback(
    (nodeId: string | null) => {
      if (!nodeId) {
        syncSelectionToStore(null)
        setSelectedNodeId((prev) => (prev === null ? prev : null))
        return
      }

      syncSelectionToStore(nodeId)
      setSelectedNodeId((prev) => (prev === nodeId ? prev : nodeId))
    },
    [syncSelectionToStore]
  )

  const noopFlyout = useCallback(() => undefined, [])

  const flyoutContextValue = useMemo(
    () => ({
      openFlyout: handleFlyoutOpen,
      activeNodeId: selectedNodeId,
      isFlyoutRender: false
    }),
    [handleFlyoutOpen, selectedNodeId]
  )

  const flyoutPreviewContextValue = useMemo(
    () => ({
      openFlyout: noopFlyout,
      activeNodeId: selectedNodeId,
      isFlyoutRender: true
    }),
    [noopFlyout, selectedNodeId]
  )

  const flyoutNodes = useMemo<Node[]>(() => {
    if (!selectedNode) {
      return []
    }

    return [
      {
        id: selectedNode.id,
        type: selectedNode.type,
        position: { x: 0, y: 0 },
        data: selectedNode.data,
        selected: true,
        draggable: false,
        connectable: false,
        dragging: false,
        selectable: false,
        focusable: false
      } as Node
    ]
  }, [selectedNode])

  const flyoutKey = useMemo(() => {
    if (!selectedNode) {
      return 'flyout-empty'
    }

    const epoch =
      (selectedNode.data as { wfEpoch?: string | number } | undefined)
        ?.wfEpoch ?? ''

    return `flyout-${selectedNode.id}-${epoch}`
  }, [selectedNode])

  const selectedNodeLabel = useMemo(() => {
    if (!selectedNode) return null
    const rawLabel = (selectedNode.data as { label?: unknown } | undefined)
      ?.label
    if (typeof rawLabel === 'string' && rawLabel.trim().length > 0) {
      return rawLabel
    }
    switch (selectedNode.type) {
      case 'trigger':
        return 'Trigger'
      case 'condition':
        return 'Condition'
      default:
        return 'Action'
    }
  }, [selectedNode])

  const handleEdgeTypeChange = useCallback(
    (edgeId, newType) => {
      if (!canEditRef.current) return
      const currentEdges = useWorkflowStore.getState().edges
      const nextEdges = currentEdges.map((edge) =>
        edge.id === edgeId
          ? {
              ...edge,
              data: { ...edge.data, edgeType: newType }
            }
          : edge
      )
      if (nextEdges === currentEdges) return
      const normalizedEdges = normalizeEdgesForState(nextEdges)
      setEdges(normalizedEdges)
    },
    [setEdges]
  )

  const handleEdgeDelete = useCallback(
    (edgeId) => {
      if (!canEditRef.current) return
      const currentEdges = useWorkflowStore.getState().edges
      const nextEdges = currentEdges.filter((e) => e.id !== edgeId)
      if (nextEdges.length !== currentEdges.length) {
        const normalizedEdges = normalizeEdgesForState(nextEdges)
        setEdges(normalizedEdges)
      }
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
    <WorkflowFlyoutProvider value={flyoutContextValue}>
      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
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
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          className="flex-1"
          onSelectionChange={handleSelectionChange}
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

        {selectedNode ? (
          <WorkflowFlyoutProvider value={flyoutPreviewContextValue}>
            <aside className="flex w-full md:w-[360px] xl:w-[420px] shrink-0 border-t md:border-t-0 md:border-l border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur flex-col">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Node details
                </div>
                <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {selectedNodeLabel}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
                <ReactFlowProvider>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                    <div className="h-full min-h-[400px]">
                      <ReactFlow
                        key={flyoutKey}
                        nodes={flyoutNodes}
                        edges={[]}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        fitView
                        fitViewOptions={{
                          padding: 0.2,
                          includeHiddenNodes: true
                        }}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        panOnDrag={false}
                        panOnScroll={false}
                        zoomOnScroll={false}
                        zoomOnPinch={false}
                        zoomOnDoubleClick={false}
                        elementsSelectable={false}
                        selectionOnDrag={false}
                        proOptions={{ hideAttribution: true }}
                        minZoom={1}
                        maxZoom={1}
                        className="h-full pointer-events-auto"
                      />
                    </div>
                  </div>
                </ReactFlowProvider>
              </div>
            </aside>
          </WorkflowFlyoutProvider>
        ) : null}
      </div>
    </WorkflowFlyoutProvider>
  )
}

import { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
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
import { X } from 'lucide-react'
import NodeHeader from '@/components/UI/ReactFlow/NodeHeader'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeCheckBoxField from '@/components/UI/InputFields/NodeCheckboxField'
import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import TriggerTypeDropdown from '@/components/Workflow/TriggerTypeDropdown'
import SendGridAction from '@/components/workflow/Actions/Email/Services/SendGridAction'
import MailGunAction from '@/components/workflow/Actions/Email/Services/MailGunAction'
import AmazonSESAction from '@/components/workflow/Actions/Email/Services/AmazonSESAction'
import SMTPAction from '@/components/workflow/Actions/Email/Services/SMTPAction'
import WebhookAction from '@/components/workflow/Actions/Webhook/Webhook'
import SlackAction from '@/components/workflow/Actions/Messaging/Services/SlackAction'
import TeamsAction from '@/components/workflow/Actions/Messaging/Services/TeamsAction'
import GoogleChatAction from '@/components/workflow/Actions/Messaging/Services/GoogleChatAction'
import SheetsAction from '@/components/workflow/Actions/Google/SheetsAction'
import HttpRequestAction from '@/components/workflow/Actions/HttpRequestAction'
import RunCustomCodeAction from '@/components/workflow/Actions/RunCustomCodeAction'
import useActionNodeController, { type ActionNodeData } from '@/components/workflow/nodes/useActionNodeController'
import useMessagingActionRestriction from '@/components/workflow/nodes/useMessagingActionRestriction'

const SCHEDULE_RESTRICTION_MESSAGE =
  'Scheduled triggers are available on workspace plans and above. Switch this trigger to Manual or Webhook to keep running on the solo plan.'

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
  // Track which node's details flyout is open for (independent of selection)
  const [flyoutNodeId, setFlyoutNodeId] = useState<string | null>(null)
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

  const flyoutNode = useWorkflowStore(
    useCallback(
      (state) =>
        flyoutNodeId
          ? (state.nodes.find((node) => node.id === flyoutNodeId) ?? null)
          : null,
      [flyoutNodeId]
    )
  )

  useEffect(() => {
    if (flyoutNodeId && !flyoutNode) {
      syncSelectionToStore(null)
      setFlyoutNodeId(null)
    }
  }, [flyoutNodeId, flyoutNode, syncSelectionToStore])

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
      // Do NOT open the flyout on selection; only the arrow button should open it.
    },
    [syncSelectionToStore]
  )

  const handleFlyoutOpen = useCallback(
    (nodeId: string | null) => {
      if (!nodeId) {
        syncSelectionToStore(null)
        setFlyoutNodeId((prev) => (prev === null ? prev : null))
        return
      }

      syncSelectionToStore(nodeId)
      setFlyoutNodeId((prev) => (prev === nodeId ? prev : nodeId))
    },
    [syncSelectionToStore]
  )

  const noopFlyout = useCallback(() => undefined, [])

  const flyoutContextValue = useMemo(
    () => ({
      openFlyout: handleFlyoutOpen,
      activeNodeId: flyoutNodeId,
      isFlyoutRender: false
    }),
    [handleFlyoutOpen, flyoutNodeId]
  )

  const flyoutPreviewContextValue = useMemo(
    () => ({
      openFlyout: noopFlyout,
      activeNodeId: flyoutNodeId,
      isFlyoutRender: true
    }),
    [noopFlyout, flyoutNodeId]
  )

  // Fields-only flyout renderer for action nodes
  const FlyoutActionFields = useCallback(
    ({ nodeId, subtype }: { nodeId: string; subtype: ActionDropSubtype }) => {
      const allNodes = useWorkflowStore(selectNodes)
      const allEdges = useWorkflowStore(selectEdges)
      const getNodeLabel = useCallback((n: Node) => {
        const rawLabel = (n.data as any)?.label
        if (typeof rawLabel === 'string' && rawLabel.trim()) return rawLabel
        switch (n.type) {
          case 'trigger':
            return 'Trigger'
          case 'condition':
            return 'Condition'
          default:
            return 'Action'
        }
      }, [])
      const inputNodeOptions = useMemo(
        () =>
          allNodes
            .filter((n) => n.id !== nodeId)
            .map((n) => ({ label: getNodeLabel(n), value: n.id })),
        [allNodes, getNodeLabel, nodeId]
      )
      const outputNodeOptions = useMemo(
        () =>
          allNodes
            .filter((n) => n.id !== nodeId && n.type !== 'trigger')
            .map((n) => ({ label: getNodeLabel(n), value: n.id })),
        [allNodes, getNodeLabel, nodeId]
      )

      const currentInputId = useMemo(() => {
        const incoming = allEdges.filter((e) => e.target === nodeId)
        return incoming[0]?.source ?? ''
      }, [allEdges, nodeId])
      const currentOutputId = useMemo(() => {
        const outgoing = allEdges.filter((e) => e.source === nodeId && !e.sourceHandle)
        return outgoing[0]?.target ?? ''
      }, [allEdges, nodeId])

      const handleChangeInput = useCallback(
        (nextSourceId: string) => {
          if (!nextSourceId || nextSourceId === currentInputId) return
          const state = useWorkflowStore.getState()
          const base = state.edges.filter((e) => e.target !== nodeId)
          const newEdge = {
            id: `e-${nextSourceId}-${nodeId}-${Date.now()}`,
            source: nextSourceId,
            target: nodeId,
            type: 'nodeEdge',
            data: { edgeType: 'default' }
          } as any
          setEdges(normalizeEdgesForState([...base, newEdge]))
        },
        [currentInputId, nodeId, setEdges]
      )

      const handleChangeOutput = useCallback(
        (nextTargetId: string) => {
          if (!nextTargetId || nextTargetId === currentOutputId) return
          // Prevent routing outputs to a trigger (triggers don't accept inputs)
          const targetNode = allNodes.find((n) => n.id === nextTargetId)
          if (targetNode?.type === 'trigger') return
          const state = useWorkflowStore.getState()
          const base = state.edges.filter(
            (e) => !(e.source === nodeId && !e.sourceHandle)
          )
          const newEdge = {
            id: `e-${nodeId}-${nextTargetId}-${Date.now()}`,
            source: nodeId,
            target: nextTargetId,
            type: 'nodeEdge',
            data: { edgeType: 'default' }
          } as any
          setEdges(normalizeEdgesForState([...base, newEdge]))
        },
        [allNodes, currentOutputId, nodeId, setEdges]
      )
      const nodeData = useWorkflowStore(
        useCallback(
          (state) =>
            (state.nodes.find((n) => n.id === nodeId)?.data as
              | ActionNodeData
              | undefined) ?? null,
          [nodeId]
        )
      )

      const controller = useActionNodeController({
        id: nodeId,
        nodeData: nodeData ?? null,
        planTier: normalizedPlanTier,
        effectiveCanEdit: canEdit,
        onRestrictionNotice,
        toggleExpanded: () => undefined,
        remove: () => useWorkflowStore.getState().removeNode(nodeId)
      })

      const handleDeleteClick = useCallback(() => {
        const ok = window.confirm('Delete this node? This action cannot be undone.')
        if (ok) controller.confirmDelete()
      }, [controller])

      // Compute plan gating for actions that have restrictions.
      // Only enable the provider matching the current subtype to avoid emitting notices for unrelated actions.
      const slackRestriction = useMessagingActionRestriction({
        provider: 'slack',
        isSoloPlan: controller.isSoloPlan,
        onRestrictionNotice,
        enabled: subtype === 'actionSlack'
      })
      const teamsRestriction = useMessagingActionRestriction({
        provider: 'teams',
        isSoloPlan: controller.isSoloPlan,
        onRestrictionNotice,
        enabled: subtype === 'actionTeams'
      })
      const messagingRestriction =
        subtype === 'actionSlack'
          ? slackRestriction
          : subtype === 'actionTeams'
            ? teamsRestriction
            : { planRestrictionMessage: null, isRestricted: false }

      const combinedRestrictionMessage =
        messagingRestriction.planRestrictionMessage ?? controller.planRestrictionMessage

      const renderFields = () => {
        switch (subtype) {
          case 'actionEmailSendgrid':
            return <SendGridAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
          case 'actionEmailMailgun':
            return <MailGunAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
          case 'actionEmailAmazonSes':
            return <AmazonSESAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
          case 'actionEmailSmtp':
            return <SMTPAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
          case 'actionWebhook':
            return <WebhookAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
          case 'actionSlack':
            return (
              <SlackAction
                nodeId={nodeId}
                canEdit={controller.effectiveCanEdit}
                isRestricted={messagingRestriction.isRestricted}
              />
            )
          case 'actionTeams':
            return (
              <TeamsAction
                nodeId={nodeId}
                canEdit={controller.effectiveCanEdit}
                isRestricted={messagingRestriction.isRestricted}
              />
            )
          case 'actionGoogleChat':
            return <GoogleChatAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
          case 'actionSheets':
            // Match node behavior: show gate message instead of fields when restricted
            return controller.planRestrictionMessage ? null : (
              <SheetsAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
            )
          case 'actionHttp':
            return <HttpRequestAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
          case 'actionCode':
            return <RunCustomCodeAction nodeId={nodeId} canEdit={controller.effectiveCanEdit} />
          default:
            return null
        }
      }

      return (
        <div className="flex flex-col gap-3">
          {/* Connections selectors */}
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Input Node</label>
              <NodeDropdownField
                options={[{ label: 'Nodes', options: inputNodeOptions }]}
                value={currentInputId}
                onChange={handleChangeInput}
                placeholder="Select input node"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Output Node</label>
              <NodeDropdownField
                options={[{ label: 'Nodes', options: outputNodeOptions }]}
                value={currentOutputId}
                onChange={handleChangeOutput}
                placeholder="Select output node"
              />
            </div>
          </div>

          <NodeHeader
            nodeId={nodeId}
            label={controller.label}
            dirty={controller.dirty}
            hasValidationErrors={controller.combinedHasValidationErrors}
            expanded={true}
            onLabelChange={controller.handleLabelChange}
            onExpanded={() => undefined}
            onConfirmingDelete={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleDeleteClick()
            }}
          />
          {controller.labelError ? (
            <p className="text-xs text-red-500">{controller.labelError}</p>
          ) : null}
          {/* Plan restriction banner (mirrors node UIs) */}
          {combinedRestrictionMessage ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
              <div className="flex items-start justify-between gap-2">
                <span>{combinedRestrictionMessage}</span>
                <button
                  type="button"
                  onClick={controller.handlePlanUpgradeClick}
                  className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-400/10"
                >
                  Upgrade
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-2 space-y-3">{renderFields()}</div>
          <div className="mt-4">
            <p className="text-xs text-zinc-500">Execution Options</p>
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <NodeInputField
                type="number"
                value={controller.timeout}
                onChange={(value) => controller.handleTimeoutChange(Number(value))}
                className="w-24 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
              />
              <span className="text-xs">ms timeout</span>
              <NodeInputField
                type="number"
                value={controller.retries}
                onChange={(value) => controller.handleRetriesChange(Number(value))}
                className="w-16 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
              />
              <span className="text-xs">retries</span>
              <NodeCheckBoxField
                checked={controller.stopOnError}
                onChange={(value) => controller.handleStopOnErrorChange(Boolean(value))}
              >
                Stop on error
              </NodeCheckBoxField>
            </div>
          </div>
        </div>
      )
    },
    [canEdit, normalizedPlanTier, onRestrictionNotice]
  )

  // Fields-only flyout renderer for trigger nodes
  const FlyoutTriggerFields = useCallback(
    ({ nodeId }: { nodeId: string }) => {
      const allNodes = useWorkflowStore(selectNodes)
      const allEdges = useWorkflowStore(selectEdges)
      const nodeData = useWorkflowStore(
        useCallback(
          (state) => (state.nodes.find((n) => n.id === nodeId)?.data as any) ?? {},
          [nodeId]
        )
      )
      const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
      const getNodeLabel = useCallback((n: Node) => {
        const rawLabel = (n.data as any)?.label
        if (typeof rawLabel === 'string' && rawLabel.trim()) return rawLabel
        switch (n.type) {
          case 'trigger':
            return 'Trigger'
          case 'condition':
            return 'Condition'
          default:
            return 'Action'
        }
      }, [])
      const nodeOptions = useMemo(
        () => allNodes.filter((n) => n.id !== nodeId && n.type !== 'trigger').map((n) => ({ label: getNodeLabel(n), value: n.id })),
        [allNodes, getNodeLabel, nodeId]
      )
      const currentOutputId = useMemo(() => {
        const outgoing = allEdges.filter((e) => e.source === nodeId)
        return outgoing[0]?.target ?? ''
      }, [allEdges, nodeId])
      const handleChangeOutput = useCallback(
        (nextTargetId: string) => {
          if (!nextTargetId || nextTargetId === currentOutputId) return
          const targetNode = allNodes.find((n) => n.id === nextTargetId)
          if (targetNode?.type === 'trigger') return
          const state = useWorkflowStore.getState()
          const base = state.edges.filter((e) => e.source !== nodeId)
          const newEdge = {
            id: `e-${nodeId}-${nextTargetId}-${Date.now()}`,
            source: nodeId,
            target: nextTargetId,
            type: 'nodeEdge',
            data: { edgeType: 'default' }
          } as any
          setEdges(normalizeEdgesForState([...base, newEdge]))
        },
        [allNodes, currentOutputId, nodeId, setEdges]
      )

      const labelError: string | null = nodeData?.labelError ?? null
      const triggerType: string =
        typeof nodeData?.triggerType === 'string' ? nodeData.triggerType : 'Manual'

      const handleLabelChange = useCallback(
        (value: string) => updateNodeData(nodeId, { label: value, dirty: true }),
        [nodeId, updateNodeData]
      )
      const handleDeleteClick = useCallback(() => {
        const ok = window.confirm('Delete this node? This action cannot be undone.')
        if (ok) useWorkflowStore.getState().removeNode(nodeId)
      }, [nodeId])
      const handleTriggerTypeChange = useCallback(
        (value: string) => updateNodeData(nodeId, { triggerType: value, dirty: true }),
        [nodeId, updateNodeData]
      )

      const inputs = Array.isArray(nodeData?.inputs) ? nodeData.inputs : []
      const handleInputsChange = useCallback(
        (vars: { key: string; value: string }[]) =>
          updateNodeData(nodeId, { inputs: vars, dirty: true }),
        [nodeId, updateNodeData]
      )

      const scheduleConfig = (nodeData?.scheduleConfig as any) || {}
      const handleSchedulePatch = useCallback(
        (patch: Record<string, any>) =>
          updateNodeData(nodeId, {
            scheduleConfig: { ...scheduleConfig, ...patch },
            dirty: true
          }),
        [nodeId, scheduleConfig, updateNodeData]
      )

      return (
        <div className="flex flex-col gap-3">
          {/* Connections selectors (Trigger has only output) */}
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Input Node</label>
              <NodeDropdownField
                options={[{ label: 'Nodes', options: [{ label: 'N/A', value: 'na', disabled: true }] }]}
                value={'N/A'}
                onChange={() => undefined}
                placeholder="N/A"
                disabled
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Output Node</label>
              <NodeDropdownField
                options={[{ label: 'Nodes', options: nodeOptions }]}
                value={currentOutputId}
                onChange={handleChangeOutput}
                placeholder="Select output node"
              />
            </div>
          </div>

          <NodeHeader
            nodeId={nodeId}
            label={(nodeData?.label as string) || 'Trigger'}
            dirty={Boolean(nodeData?.dirty)}
            hasValidationErrors={Boolean(labelError)}
            expanded={true}
            onLabelChange={handleLabelChange}
            onExpanded={() => undefined}
            onConfirmingDelete={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleDeleteClick()
            }}
          />
          {labelError ? (
            <p className="text-xs text-red-500">{labelError}</p>
          ) : null}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Trigger Type
            </label>
            <div className="mt-2">
              <TriggerTypeDropdown
                value={triggerType}
                onChange={handleTriggerTypeChange}
                disabledOptions={
                  isSoloPlan ? { Schedule: SCHEDULE_RESTRICTION_MESSAGE } : {}
                }
              />
            </div>
          </div>

          {triggerType === 'Schedule' ? (
            <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/40 space-y-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Start Date (YYYY-MM-DD)
                </label>
                <NodeInputField
                  placeholder="2025-01-31"
                  value={scheduleConfig.startDate || ''}
                  onChange={(v) => handleSchedulePatch({ startDate: v })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Start Time (HH:MM)
                </label>
                <NodeInputField
                  placeholder="09:00"
                  value={scheduleConfig.startTime || ''}
                  onChange={(v) => handleSchedulePatch({ startTime: v })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Timezone
                </label>
                <NodeInputField
                  placeholder="UTC"
                  value={scheduleConfig.timezone || ''}
                  onChange={(v) => handleSchedulePatch({ timezone: v })}
                />
              </div>
            </div>
          ) : null}

          <KeyValuePair
            title="Input Variables"
            variables={inputs}
            onChange={(vars) => handleInputsChange(vars)}
          />
        </div>
      )
    },
    []
  )

  // Fields-only flyout renderer for condition nodes
  const FlyoutConditionFields = useCallback(
    ({ nodeId }: { nodeId: string }) => {
      const allNodes = useWorkflowStore(selectNodes)
      const allEdges = useWorkflowStore(selectEdges)
      const nodeData = useWorkflowStore(
        useCallback(
          (state) => (state.nodes.find((n) => n.id === nodeId)?.data as any) ?? {},
          [nodeId]
        )
      )
      const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
      const getNodeLabel = useCallback((n: Node) => {
        const rawLabel = (n.data as any)?.label
        if (typeof rawLabel === 'string' && rawLabel.trim()) return rawLabel
        switch (n.type) {
          case 'trigger':
            return 'Trigger'
          case 'condition':
            return 'Condition'
          default:
            return 'Action'
        }
      }, [])
      const nodeOptions = useMemo(
        () =>
          allNodes
            .filter((n) => n.id !== nodeId && n.type !== 'trigger')
            .map((n) => ({ label: getNodeLabel(n), value: n.id })),
        [allNodes, getNodeLabel, nodeId]
      )
      const trueOutputId = useMemo(() => {
        const t = allEdges.find((e) => e.source === nodeId && e.sourceHandle === 'cond-true')
        return t?.target ?? ''
      }, [allEdges, nodeId])
      const falseOutputId = useMemo(() => {
        const f = allEdges.find((e) => e.source === nodeId && e.sourceHandle === 'cond-false')
        return f?.target ?? ''
      }, [allEdges, nodeId])
      const changeCondOutput = useCallback(
        (handle: 'cond-true' | 'cond-false', nextTargetId: string) => {
          const currId = handle === 'cond-true' ? trueOutputId : falseOutputId
          if (!nextTargetId || nextTargetId === currId) return
          // Prevent routing condition outputs to a trigger
          const targetNode = allNodes.find((n) => n.id === nextTargetId)
          if (targetNode?.type === 'trigger') return
          const state = useWorkflowStore.getState()
          const base = state.edges.filter(
            (e) => !(e.source === nodeId && e.sourceHandle === handle)
          )
          const label = handle === 'cond-true' ? 'True' : 'False'
          const outcome = handle === 'cond-true' ? 'true' : 'false'
          const newEdge = {
            id: `e-${nodeId}-${handle}-${nextTargetId}-${Date.now()}`,
            source: nodeId,
            sourceHandle: handle,
            target: nextTargetId,
            type: 'nodeEdge',
            label,
            data: { edgeType: 'default', outcome }
          } as any
          setEdges(normalizeEdgesForState([...base, newEdge]))
        },
        [allNodes, falseOutputId, nodeId, setEdges, trueOutputId]
      )

      const labelError: string | null = nodeData?.labelError ?? null
      const field = typeof nodeData?.field === 'string' ? nodeData.field : ''
      const operator =
        typeof nodeData?.operator === 'string' ? nodeData.operator : 'equals'
      const value = typeof nodeData?.value === 'string' ? nodeData.value : ''

      const buildExpression = useCallback((f: string, op: string, v: string) => {
        const left = (f || '').trim()
        if (!left) return ''
        const OP: Record<string, string> = {
          equals: '==',
          'not equals': '!=',
          'greater than': '>',
          'less than': '<',
          contains: 'contains'
        }
        const opSym = OP[(op || 'equals').toLowerCase()] ?? '=='
        const formattedLeft = left.startsWith('{{') ? left : `{{${left}}}`
        const formattedRight = (() => {
          const t = (v || '').trim()
          if (!t) return '""'
          if (t.startsWith('{{') && t.endsWith('}}')) return t
          if (/^(true|false|null)$/i.test(t)) return t.toLowerCase()
          if (!Number.isNaN(Number(t))) return t
          if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
            try {
              return JSON.stringify(JSON.parse(t))
            } catch {
              return JSON.stringify(t.slice(1, -1))
            }
          }
          return JSON.stringify(t)
        })()
        return `${formattedLeft} ${opSym} ${formattedRight}`.trim()
      }, [])

      const hasValidationErrors = !field.trim() || !value.trim()
      useEffect(() => {
        const expression = buildExpression(field, operator, value)
        updateNodeData(nodeId, { expression, hasValidationErrors })
      }, [buildExpression, field, operator, value, nodeId, updateNodeData, hasValidationErrors])

      const handleLabelChange = useCallback(
        (v: string) => updateNodeData(nodeId, { label: v, dirty: true }),
        [nodeId, updateNodeData]
      )
      const handleDeleteClick = useCallback(() => {
        const ok = window.confirm('Delete this node? This action cannot be undone.')
        if (ok) useWorkflowStore.getState().removeNode(nodeId)
      }, [nodeId])
      const handleField = useCallback(
        (v: string) =>
          updateNodeData(nodeId, {
            field: v,
            dirty: true
          }),
        [nodeId, updateNodeData]
      )
      const handleOperator = useCallback(
        (v: string) => updateNodeData(nodeId, { operator: v, dirty: true }),
        [nodeId, updateNodeData]
      )
      const handleValue = useCallback(
        (v: string) => updateNodeData(nodeId, { value: v, dirty: true }),
        [nodeId, updateNodeData]
      )

      return (
        <div className="flex flex-col gap-3">
          {/* Connections selectors (Condition has True/False outputs) */}
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Input Node</label>
              <NodeDropdownField
                options={[{ label: 'Nodes', options: allNodes.filter((n) => n.id !== nodeId).map((n) => ({ label: getNodeLabel(n), value: n.id })) }]}
                value={allEdges.find((e) => e.target === nodeId)?.source ?? ''}
                onChange={(nextSourceId) => {
                  const state = useWorkflowStore.getState()
                  const base = state.edges.filter((e) => e.target !== nodeId)
                  const newEdge = {
                    id: `e-${nextSourceId}-${nodeId}-${Date.now()}`,
                    source: nextSourceId,
                    target: nodeId,
                    type: 'nodeEdge',
                    data: { edgeType: 'default' }
                  } as any
                  setEdges(normalizeEdgesForState([...base, newEdge]))
                }}
                placeholder="Select input node"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">True Output</label>
              <NodeDropdownField
                options={[{ label: 'Nodes', options: nodeOptions }]}
                value={trueOutputId}
                onChange={(v) => changeCondOutput('cond-true', v)}
                placeholder="Select true output"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">False Output</label>
              <NodeDropdownField
                options={[{ label: 'Nodes', options: nodeOptions }]}
                value={falseOutputId}
                onChange={(v) => changeCondOutput('cond-false', v)}
                placeholder="Select false output"
              />
            </div>
          </div>

          <NodeHeader
            nodeId={nodeId}
            label={(nodeData?.label as string) || 'Condition'}
            dirty={Boolean(nodeData?.dirty)}
            hasValidationErrors={Boolean(labelError) || hasValidationErrors}
            expanded={true}
            onLabelChange={handleLabelChange}
            onExpanded={() => undefined}
            onConfirmingDelete={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleDeleteClick()
            }}
          />
          {labelError ? (
            <p className="text-xs text-red-500">{labelError}</p>
          ) : null}

          <NodeInputField placeholder="Field name" value={field} onChange={handleField} />
          <NodeDropdownField
            options={["equals", "not equals", "greater than", "less than", "contains"]}
            value={operator}
            onChange={handleOperator}
          />
          <NodeInputField placeholder="Comparison value" value={value} onChange={handleValue} />
        </div>
      )
    },
    []
  )


  const flyoutSubtype = useMemo<ActionDropSubtype | null>(() => {
    if (!flyoutNode) return null
    const t = (flyoutNode.type || '').toString()
    if (t === 'trigger' || t === 'condition') return null
    const known = new Set([
      'actionEmailSendgrid',
      'actionEmailMailgun',
      'actionEmailAmazonSes',
      'actionEmailSmtp',
      'actionWebhook',
      'actionSlack',
      'actionTeams',
      'actionGoogleChat',
      'actionSheets',
      'actionHttp',
      'actionCode'
    ])
    if (known.has(t)) {
      return t as ActionDropSubtype
    }
    return determineActionSubtype(flyoutNode.data)
  }, [flyoutNode, determineActionSubtype])

  const selectedNodeLabel = useMemo(() => {
    if (!flyoutNode) return null
    const rawLabel = (flyoutNode.data as { label?: unknown } | undefined)
      ?.label
    if (typeof rawLabel === 'string' && rawLabel.trim().length > 0) {
      return rawLabel
    }
    switch (flyoutNode.type) {
      case 'trigger':
        return 'Trigger'
      case 'condition':
        return 'Condition'
      default:
        return 'Action'
    }
  }, [flyoutNode])

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

        {flyoutNode ? (
          <WorkflowFlyoutProvider value={flyoutPreviewContextValue}>
            <aside className="flex w-full md:w-[360px] xl:w-[420px] shrink-0 border-t md:border-t-0 md:border-l border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur flex-col">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Node details
                  </div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {selectedNodeLabel}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFlyoutNodeId(null)}
                  className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  aria-label="Close details"
                  title="Close details"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4">
                  {flyoutNode.type === 'trigger' ? (
                    <FlyoutTriggerFields nodeId={flyoutNode.id} />
                  ) : flyoutNode.type === 'condition' ? (
                    <FlyoutConditionFields nodeId={flyoutNode.id} />
                  ) : flyoutSubtype ? (
                    <FlyoutActionFields nodeId={flyoutNode.id} subtype={flyoutSubtype} />
                  ) : (
                    <p className="text-xs text-zinc-500">
                      Fields for this node type are not available in the flyout yet.
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </WorkflowFlyoutProvider>
        ) : null}
      </div>
    </WorkflowFlyoutProvider>
  )
}

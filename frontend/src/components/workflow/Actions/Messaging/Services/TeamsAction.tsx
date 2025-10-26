import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import deepEqual from 'fast-deep-equal'
import NodeDropdownField, {
  type NodeDropdownOptionGroup
} from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import {
  fetchConnections,
  getCachedConnections,
  subscribeToConnectionUpdates,
  type ConnectionScope,
  type ProviderConnectionSet
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'
import {
  fetchMicrosoftTeams,
  fetchMicrosoftTeamChannels,
  fetchMicrosoftChannelMembers,
  type MicrosoftTeam,
  type MicrosoftChannel,
  type MicrosoftChannelMember,
  type MicrosoftConnectionOptions
} from '@/lib/microsoftGraphApi'

export interface TeamsMention {
  userId: string
  displayName?: string
}

export interface TeamsConnectionSelection {
  connectionScope?: 'workspace' | 'user'
  connectionId?: string
  accountEmail?: string
}

export interface TeamsActionValues {
  deliveryMethod?: string
  webhookType?: string
  webhookUrl?: string
  title?: string
  summary?: string
  themeColor?: string
  message?: string
  cardJson?: string
  cardMode?: string
  cardTitle?: string
  cardBody?: string
  workflowOption?: string
  workflowRawJson?: string
  workflowHeaderName?: string
  workflowHeaderSecret?: string
  oauthProvider?: string
  oauthConnectionId?: string
  oauthConnectionScope?: ConnectionScope
  oauthAccountEmail?: string
  teamId?: string
  teamName?: string
  channelId?: string
  channelName?: string
  messageType?: string
  mentions?: TeamsMention[]
  connection?: TeamsConnectionSelection
}

interface TeamsActionProps {
  nodeId: string
  canEdit?: boolean
  isRestricted?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const extractTeamsParams = (source: unknown): TeamsActionValues => {
  if (isRecord(source)) {
    const record = source as Record<string, unknown>
    const teamsRecord = isRecord(record['Teams'])
      ? (record['Teams'] as Record<string, unknown>)
      : isRecord(record['teams'])
        ? (record['teams'] as Record<string, unknown>)
        : record

    if (isRecord(teamsRecord)) {
      return teamsRecord as TeamsActionValues
    }
  }

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return source as TeamsActionValues
  }

  return {} as TeamsActionValues
}

const DELIVERY_METHOD_INCOMING = 'Incoming Webhook'
const DELIVERY_METHOD_DELEGATED = 'Delegated OAuth (Post as user)'

const deliveryOptions = [
  DELIVERY_METHOD_INCOMING,
  DELIVERY_METHOD_DELEGATED
] as const

const webhookOptions = ['Connector', 'Workflow/Power Automate']

const workflowOptions = ['Basic (Raw JSON)', 'Header Secret Auth']

const delegatedMessageTypes = ['Text', 'Card'] as const

type DelegatedMessageType = (typeof delegatedMessageTypes)[number]

const delegatedCardModes = ['Simple card builder', 'Custom JSON'] as const

type DelegatedCardMode = (typeof delegatedCardModes)[number]

const buildSimpleAdaptiveCardJson = (title: string, body: string) => {
  const trimmedBody = body.trim()
  const trimmedTitle = title.trim()

  if (!trimmedBody) {
    return ''
  }

  const cardBody: Array<Record<string, string | boolean>> = []

  if (trimmedTitle) {
    cardBody.push({
      type: 'TextBlock',
      text: trimmedTitle,
      weight: 'Bolder',
      size: 'Medium'
    })
  }

  cardBody.push({
    type: 'TextBlock',
    text: trimmedBody,
    wrap: true
  })

  const payload = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: cardBody
  }

  return JSON.stringify(payload, null, 2)
}

const STRING_KEYS: (keyof TeamsActionValues)[] = [
  'deliveryMethod',
  'webhookType',
  'webhookUrl',
  'title',
  'summary',
  'themeColor',
  'message',
  'cardJson',
  'cardMode',
  'cardTitle',
  'cardBody',
  'workflowOption',
  'workflowRawJson',
  'workflowHeaderName',
  'workflowHeaderSecret',
  'oauthProvider',
  'oauthConnectionId',
  'oauthAccountEmail',
  'teamId',
  'teamName',
  'channelId',
  'channelName',
  'messageType'
]

const sanitizeMentions = (mentions?: TeamsMention[]): TeamsMention[] => {
  if (!Array.isArray(mentions)) return []
  const seen = new Set<string>()
  return mentions
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const rawUserId =
        typeof entry.userId === 'string'
          ? entry.userId
          : typeof (entry as any).user_id === 'string'
            ? (entry as any).user_id
            : ''
      const userId = rawUserId.trim()
      if (!userId || seen.has(userId)) return null
      seen.add(userId)

      const rawDisplay =
        typeof entry.displayName === 'string'
          ? entry.displayName
          : typeof (entry as any).display_name === 'string'
            ? (entry as any).display_name
            : ''
      const displayName = rawDisplay.trim()

      return displayName ? { userId, displayName } : { userId }
    })
    .filter((mention): mention is TeamsMention => Boolean(mention))
}

const buildConnectionSelectionFromParts = (
  scope?: string,
  id?: string,
  email?: string
): TeamsConnectionSelection | null => {
  const normalizedScope =
    typeof scope === 'string' ? scope.trim().toLowerCase() : ''
  const normalizedEmail = typeof email === 'string' ? email.trim() : ''
  const normalizedId = (() => {
    if (typeof id !== 'string') return ''
    const trimmed = id.trim()
    if (!trimmed) return ''
    if (
      (normalizedScope === 'personal' || normalizedScope === 'user') &&
      trimmed.toLowerCase() === 'microsoft'
    ) {
      return ''
    }
    return trimmed
  })()

  if (normalizedScope === 'workspace') {
    if (!normalizedId) return null
    return {
      connectionScope: 'workspace',
      connectionId: normalizedId,
      ...(normalizedEmail ? { accountEmail: normalizedEmail } : {})
    }
  }

  if (normalizedScope === 'personal' || normalizedScope === 'user') {
    if (!normalizedId && !normalizedEmail) {
      return null
    }
    const selection: TeamsConnectionSelection = { connectionScope: 'user' }
    if (normalizedId) {
      selection.connectionId = normalizedId
    }
    if (normalizedEmail) {
      selection.accountEmail = normalizedEmail
    }
    return selection
  }

  return null
}

const buildConnectionSelectionFromValue = (
  value: unknown
): TeamsConnectionSelection | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const scope = (value as Record<string, unknown>).connectionScope
  const id = (value as Record<string, unknown>).connectionId
  const email = (value as Record<string, unknown>).accountEmail

  return buildConnectionSelectionFromParts(
    typeof scope === 'string' ? scope : undefined,
    typeof id === 'string' ? id : undefined,
    typeof email === 'string' ? email : undefined
  )
}

const cloneConnectionSelection = (
  selection?: TeamsConnectionSelection
): TeamsConnectionSelection | undefined => {
  if (!selection) return undefined
  const cloned: TeamsConnectionSelection = {
    connectionScope: selection.connectionScope
  }
  if (selection.connectionId) {
    cloned.connectionId = selection.connectionId
  }
  if (selection.accountEmail) {
    cloned.accountEmail = selection.accountEmail
  }
  return cloned
}

const selectionsEqual = (
  a?: TeamsConnectionSelection,
  b?: TeamsConnectionSelection
) => {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.connectionScope === b.connectionScope &&
    (a.connectionId ?? '') === (b.connectionId ?? '') &&
    (a.accountEmail ?? '') === (b.accountEmail ?? '')
  )
}

const applyConnectionSelection = (
  current: TeamsActionValues,
  selection: TeamsConnectionSelection | null
): TeamsActionValues => {
  const next: TeamsActionValues = {
    ...current,
    oauthProvider: selection ? 'microsoft' : ''
  }

  if (!selection) {
    delete (next as Record<string, unknown>).oauthConnectionScope
    next.oauthConnectionId = ''
    next.oauthAccountEmail = ''
    if ('connection' in next) {
      delete (next as Record<string, unknown>).connection
    }
    return next
  }

  const scope =
    selection.connectionScope === 'workspace' ? 'workspace' : 'personal'
  next.oauthConnectionScope = scope
  next.oauthAccountEmail = selection.accountEmail ?? ''
  next.oauthConnectionId =
    selection.connectionScope === 'workspace'
      ? (selection.connectionId ?? '')
      : selection.connectionId && selection.connectionId.trim().length > 0
        ? selection.connectionId
        : 'microsoft'
  next.connection = cloneConnectionSelection(selection)

  return next
}

const connectionInfoToSelection = (
  entry:
    | ProviderConnectionSet['personal']
    | ProviderConnectionSet['workspace'][number]
): TeamsConnectionSelection | null => {
  if (!entry) return null
  const email =
    typeof entry.accountEmail === 'string' ? entry.accountEmail.trim() : ''
  if (entry.scope === 'workspace') {
    if (!entry.id) return null
    return {
      connectionScope: 'workspace',
      connectionId: entry.id,
      ...(email ? { accountEmail: email } : {})
    }
  }

  const selection: TeamsConnectionSelection = { connectionScope: 'user' }
  if (entry.id) {
    selection.connectionId = entry.id
  }
  if (email) {
    selection.accountEmail = email
  }
  return selection
}

const normalizeParams = (incoming?: TeamsActionValues): TeamsActionValues => {
  const base: TeamsActionValues = {
    deliveryMethod: DELIVERY_METHOD_INCOMING,
    webhookType: webhookOptions[0],
    webhookUrl: '',
    title: '',
    summary: '',
    themeColor: '',
    message: '',
    cardJson: '',
    cardMode: delegatedCardModes[0],
    cardTitle: '',
    cardBody: '',
    workflowOption: workflowOptions[0],
    workflowRawJson: '',
    workflowHeaderName: '',
    workflowHeaderSecret: '',
    oauthProvider: '',
    oauthConnectionId: '',
    oauthAccountEmail: '',
    teamId: '',
    teamName: '',
    channelId: '',
    channelName: '',
    messageType: delegatedMessageTypes[0],
    mentions: []
  }

  if (!incoming) return base

  const next: TeamsActionValues = { ...base }

  STRING_KEYS.forEach((key) => {
    const value = incoming[key]
    if (typeof value === 'string') {
      ;(next as Record<string, string | undefined>)[
        key as Extract<keyof TeamsActionValues, string>
      ] = value
    }
  })

  next.mentions = sanitizeMentions(incoming.mentions)

  const connectionScope = (() => {
    const rawScope =
      typeof (incoming as any)?.connectionScope === 'string'
        ? (incoming as any).connectionScope.trim()
        : ''
    if (rawScope) return rawScope
    const connection = (incoming as any)?.connection
    if (
      connection &&
      typeof connection === 'object' &&
      !Array.isArray(connection)
    ) {
      const scoped = connection.connectionScope
      if (typeof scoped === 'string') {
        return scoped.trim()
      }
    }
    return ''
  })()

  const connectionId = (() => {
    const rawId =
      typeof (incoming as any)?.connectionId === 'string'
        ? (incoming as any).connectionId.trim()
        : ''
    if (rawId) return rawId
    const oauthId =
      typeof incoming?.oauthConnectionId === 'string'
        ? incoming.oauthConnectionId.trim()
        : ''
    if (oauthId) return oauthId
    const connection = (incoming as any)?.connection
    if (
      connection &&
      typeof connection === 'object' &&
      !Array.isArray(connection)
    ) {
      const id = connection.connectionId
      if (typeof id === 'string') {
        return id.trim()
      }
    }
    return ''
  })()

  const connectionEmail = (() => {
    const fromTop =
      typeof (incoming as any)?.accountEmail === 'string'
        ? (incoming as any).accountEmail.trim()
        : ''
    if (fromTop) return fromTop
    const fromOauth =
      typeof incoming?.oauthAccountEmail === 'string'
        ? incoming.oauthAccountEmail.trim()
        : ''
    if (fromOauth) return fromOauth
    const connection = (incoming as any)?.connection
    if (
      connection &&
      typeof connection === 'object' &&
      !Array.isArray(connection)
    ) {
      const email = connection.accountEmail
      if (typeof email === 'string') {
        return email.trim()
      }
    }
    return ''
  })()

  if (connectionEmail) {
    next.oauthAccountEmail = connectionEmail
  }

  const normalizedScope = connectionScope.toLowerCase()
  if (normalizedScope === 'workspace' && connectionId) {
    next.oauthConnectionScope = 'workspace'
    next.oauthConnectionId = connectionId
  } else if (
    (normalizedScope === 'user' || normalizedScope === 'personal') &&
    connectionId
  ) {
    next.oauthConnectionScope = 'personal'
    next.oauthConnectionId = connectionId
  }

  const normalizedConnection =
    buildConnectionSelectionFromValue((incoming as any)?.connection) ??
    buildConnectionSelectionFromParts(
      normalizedScope || connectionScope,
      connectionId,
      connectionEmail || next.oauthAccountEmail
    )

  if (normalizedConnection) {
    next.connection = cloneConnectionSelection(normalizedConnection)
  } else if ('connection' in next) {
    delete (next as Record<string, unknown>).connection
  }

  return next
}

const computeTeamsPatch = (
  current: TeamsActionValues,
  next: TeamsActionValues
): Partial<TeamsActionValues> => {
  const patch: Partial<TeamsActionValues> = {}
  const keys = new Set<keyof TeamsActionValues>([
    ...(Object.keys(current) as (keyof TeamsActionValues)[]),
    ...(Object.keys(next) as (keyof TeamsActionValues)[])
  ])

  keys.forEach((key) => {
    if (!deepEqual(current[key], next[key])) {
      ;(patch as Record<string, unknown>)[
        key as Extract<keyof TeamsActionValues, string>
      ] = next[key] as unknown
    }
  })

  return patch
}

const sanitizeForSelection = (
  current: TeamsActionValues,
  {
    isIncomingWebhook,
    isConnector,
    isWorkflow,
    workflowUsesHeaderSecret,
    isDelegated,
    delegatedMessageType,
    delegatedCardMode
  }: {
    isIncomingWebhook: boolean
    isConnector: boolean
    isWorkflow: boolean
    workflowUsesHeaderSecret: boolean
    isDelegated: boolean
    delegatedMessageType: DelegatedMessageType
    delegatedCardMode: DelegatedCardMode
  }
): TeamsActionValues => {
  const normalized = normalizeParams(current)
  const sanitized: TeamsActionValues = {
    ...normalized,
    mentions: sanitizeMentions(normalized.mentions)
  }

  if (isIncomingWebhook) {
    sanitized.oauthProvider = ''
    sanitized.oauthConnectionId = ''
    delete (sanitized as Record<string, unknown>).oauthConnectionScope
    sanitized.oauthAccountEmail = ''
    sanitized.teamId = ''
    sanitized.teamName = ''
    sanitized.channelId = ''
    sanitized.channelName = ''
    sanitized.messageType = delegatedMessageTypes[0]
    sanitized.mentions = []
    sanitized.cardMode = delegatedCardModes[0]
    sanitized.cardTitle = ''
    sanitized.cardBody = ''

    const webhookType = sanitized.webhookType || webhookOptions[0]
    sanitized.webhookType = webhookType

    const webhookUrl = sanitized.webhookUrl?.trim()

    if (isConnector) {
      if (!webhookUrl) {
        sanitized.webhookUrl = ''
      }
    }

    if (!isConnector) {
      sanitized.title = ''
      sanitized.summary = ''
      sanitized.themeColor = ''
      sanitized.message = ''
    }

    if (isWorkflow) {
      sanitized.title = ''
      sanitized.summary = ''
      sanitized.themeColor = ''
      sanitized.message = ''

      const option = sanitized.workflowOption || workflowOptions[0]
      sanitized.workflowOption = workflowOptions.includes(option)
        ? option
        : workflowOptions[0]

      if (!workflowUsesHeaderSecret) {
        sanitized.workflowHeaderName = ''
        sanitized.workflowHeaderSecret = ''
      }
    } else {
      sanitized.workflowOption = ''
      sanitized.workflowRawJson = ''
      sanitized.workflowHeaderName = ''
      sanitized.workflowHeaderSecret = ''
      sanitized.cardJson = ''
      sanitized.cardMode = delegatedCardModes[0]
      sanitized.cardTitle = ''
      sanitized.cardBody = ''
    }

    delete sanitized.connection

    return sanitized
  }

  if (isDelegated) {
    sanitized.webhookType = ''
    sanitized.webhookUrl = ''
    sanitized.title = ''
    sanitized.summary = ''
    sanitized.themeColor = ''
    sanitized.workflowOption = ''
    sanitized.workflowRawJson = ''
    sanitized.workflowHeaderName = ''
    sanitized.workflowHeaderSecret = ''
    sanitized.oauthProvider = 'microsoft'
    sanitized.teamId = sanitized.teamId?.trim() || ''
    sanitized.teamName = sanitized.teamName?.trim() || ''
    sanitized.channelId = sanitized.channelId?.trim() || ''
    sanitized.channelName = sanitized.channelName?.trim() || ''

    const inferredSelection =
      normalized.connection ||
      buildConnectionSelectionFromParts(
        sanitized.oauthConnectionScope,
        sanitized.oauthConnectionId,
        sanitized.oauthAccountEmail
      )

    if (inferredSelection) {
      sanitized.connection = cloneConnectionSelection(inferredSelection)
      sanitized.oauthConnectionScope =
        inferredSelection.connectionScope === 'workspace'
          ? 'workspace'
          : 'personal'
      sanitized.oauthAccountEmail = inferredSelection.accountEmail ?? ''
      sanitized.oauthConnectionId =
        inferredSelection.connectionScope === 'workspace'
          ? (inferredSelection.connectionId ?? '')
          : inferredSelection.connectionId &&
              inferredSelection.connectionId.trim().length > 0
            ? inferredSelection.connectionId
            : 'microsoft'
    } else {
      delete (sanitized as Record<string, unknown>).oauthConnectionScope
      sanitized.oauthConnectionId = ''
      sanitized.oauthAccountEmail = ''
      if ('connection' in sanitized) {
        delete (sanitized as Record<string, unknown>).connection
      }
    }

    if (!sanitized.oauthConnectionScope || !sanitized.oauthConnectionId) {
      sanitized.teamId = ''
      sanitized.teamName = ''
      sanitized.channelId = ''
      sanitized.channelName = ''
      sanitized.mentions = []
    }

    sanitized.messageType = delegatedMessageType

    if (delegatedMessageType === 'Card') {
      const cardMode = delegatedCardModes.includes(delegatedCardMode)
        ? delegatedCardMode
        : delegatedCardModes[0]

      sanitized.cardMode = cardMode
      sanitized.message = ''
      sanitized.mentions = []

      if (cardMode === delegatedCardModes[0]) {
        const title = sanitized.cardTitle?.trim() || ''
        const body = sanitized.cardBody?.trim() || ''
        sanitized.cardTitle = title
        sanitized.cardBody = body
        sanitized.cardJson = buildSimpleAdaptiveCardJson(title, body)
      } else {
        sanitized.cardTitle = ''
        sanitized.cardBody = ''
        sanitized.cardJson = sanitized.cardJson?.trim() || ''
      }
    } else {
      sanitized.cardJson = ''
      sanitized.cardMode = delegatedCardModes[0]
      sanitized.cardTitle = ''
      sanitized.cardBody = ''
    }

    return sanitized
  }

  sanitized.webhookType = webhookOptions[0]
  sanitized.webhookUrl = ''
  sanitized.title = ''
  sanitized.summary = ''
  sanitized.themeColor = ''
  sanitized.message = ''
  sanitized.cardJson = ''
  sanitized.workflowOption = ''
  sanitized.workflowRawJson = ''
  sanitized.workflowHeaderName = ''
  sanitized.workflowHeaderSecret = ''
  sanitized.oauthProvider = ''
  sanitized.oauthConnectionId = ''
  delete (sanitized as Record<string, unknown>).oauthConnectionScope
  sanitized.oauthAccountEmail = ''
  sanitized.teamId = ''
  sanitized.teamName = ''
  sanitized.channelId = ''
  sanitized.channelName = ''
  sanitized.messageType = delegatedMessageTypes[0]
  sanitized.mentions = []
  sanitized.cardMode = delegatedCardModes[0]
  sanitized.cardTitle = ''
  sanitized.cardBody = ''

  delete sanitized.connection

  return sanitized
}

interface TeamsParamContext {
  isIncomingWebhook: boolean
  isDelegated: boolean
  isConnector: boolean
  isWorkflow: boolean
  workflowOption: string
  workflowUsesHeaderSecret: boolean
  delegatedMessageType: DelegatedMessageType
  delegatedCardMode: DelegatedCardMode
}

const deriveParamContext = (current: TeamsActionValues): TeamsParamContext => {
  const deliveryMethod = current.deliveryMethod || DELIVERY_METHOD_INCOMING
  const isIncomingWebhook = deliveryMethod === DELIVERY_METHOD_INCOMING
  const isDelegated = deliveryMethod === DELIVERY_METHOD_DELEGATED

  const webhookType = current.webhookType || webhookOptions[0]
  const isConnector = isIncomingWebhook && webhookType === webhookOptions[0]
  const isWorkflow = isIncomingWebhook && webhookType === webhookOptions[1]

  const rawWorkflowOption = current.workflowOption || workflowOptions[0]
  const workflowOption = workflowOptions.includes(rawWorkflowOption)
    ? rawWorkflowOption
    : workflowOptions[0]
  const workflowUsesHeaderSecret = workflowOption === workflowOptions[1]

  const rawMessageType =
    (current.messageType as DelegatedMessageType) ?? delegatedMessageTypes[0]
  const delegatedMessageType = delegatedMessageTypes.includes(rawMessageType)
    ? rawMessageType
    : delegatedMessageTypes[0]

  const rawCardMode =
    (current.cardMode as DelegatedCardMode) ?? delegatedCardModes[0]
  const delegatedCardMode = delegatedCardModes.includes(rawCardMode)
    ? rawCardMode
    : delegatedCardModes[0]

  return {
    isIncomingWebhook,
    isDelegated,
    isConnector,
    isWorkflow,
    workflowOption,
    workflowUsesHeaderSecret,
    delegatedMessageType,
    delegatedCardMode
  }
}

const validateTeamsParams = (
  params: TeamsActionValues,
  context: TeamsParamContext,
  {
    connectionsError,
    connectionsLoading,
    connectionChoices,
    hasMicrosoftAccount,
    teamsError,
    teamsLoading,
    channelsError,
    channelsLoading
  }: {
    connectionsError: string | null
    connectionsLoading: boolean
    connectionChoices: (
      | ProviderConnectionSet['personal']
      | ProviderConnectionSet['workspace'][number]
    )[]
    hasMicrosoftAccount: boolean
    teamsError: string | null
    teamsLoading: boolean
    channelsError: string | null
    channelsLoading: boolean
  }
): Record<string, string> => {
  const errors: Record<string, string> = {}

  const deliveryMethod = params.deliveryMethod?.trim() ?? ''
  if (!deliveryMethod) {
    errors.deliveryMethod = 'Delivery method is required'
  } else if (
    deliveryMethod !== DELIVERY_METHOD_INCOMING &&
    deliveryMethod !== DELIVERY_METHOD_DELEGATED
  ) {
    errors.deliveryMethod =
      'Only incoming webhooks or delegated OAuth are supported'
  }

  if (context.isIncomingWebhook) {
    if (!params.webhookType?.trim()) {
      errors.webhookType = 'Webhook type is required'
    }
    if (!params.webhookUrl?.trim()) {
      errors.webhookUrl = 'Webhook URL is required'
    }

    if (context.isConnector && params.themeColor?.trim()) {
      const sanitized = params.themeColor.trim().replace(/^#/, '')
      const hexRegex = /^[0-9a-fA-F]{6}$/
      if (!hexRegex.test(sanitized)) {
        errors.themeColor = 'Theme color must be a 6-digit hex value'
      }
    }

    if (context.isConnector && !params.message?.trim()) {
      errors.message = 'Message cannot be empty'
    }

    if (context.isWorkflow) {
      if (!params.workflowOption?.trim()) {
        errors.workflowOption = 'Workflow option is required'
      }

      const raw = params.workflowRawJson?.trim()
      if (!raw) {
        errors.workflowRawJson = 'Raw JSON payload is required'
      } else {
        try {
          JSON.parse(raw)
        } catch (error) {
          errors.workflowRawJson = 'Raw JSON payload must be valid JSON'
        }
      }

      if (context.workflowUsesHeaderSecret) {
        if (!params.workflowHeaderName?.trim()) {
          errors.workflowHeaderName = 'Header name is required'
        }
        if (!params.workflowHeaderSecret?.trim()) {
          errors.workflowHeaderSecret = 'Header secret is required'
        }
      }
    }
  } else if (context.isDelegated) {
    if (!params.oauthProvider?.trim()) {
      errors.oauthProvider = 'Microsoft OAuth is required for delegated posts'
    }

    if (connectionsError) {
      errors.oauthConnectionId = connectionsError
    } else if (!connectionsLoading) {
      const scope =
        params.oauthConnectionScope === 'personal' ||
        params.oauthConnectionScope === 'workspace'
          ? (params.oauthConnectionScope as ConnectionScope)
          : undefined
      const id = params.oauthConnectionId?.trim()

      if (!scope || !id) {
        if (!hasMicrosoftAccount) {
          errors.oauthConnectionId =
            'Connect Microsoft in Settings → Integrations to post from Teams.'
        } else {
          errors.oauthConnectionId = 'Microsoft connection is required'
        }
      } else if (
        !connectionChoices.some((choice) => {
          if (choice.scope !== scope) return false
          if (scope === 'personal') {
            return id === 'microsoft' || choice.id === id
          }
          return choice.id === id
        })
      ) {
        errors.oauthConnectionId =
          'Selected Microsoft connection is no longer available. Refresh your integrations.'
      }
    }

    if (teamsError) {
      errors.teamId = teamsError
    } else if (!teamsLoading && !params.teamId?.trim()) {
      errors.teamId = 'Team is required'
    }

    if (channelsError) {
      errors.channelId = channelsError
    } else if (!channelsLoading && !params.channelId?.trim()) {
      errors.channelId = 'Channel is required'
    }

    if (context.delegatedMessageType === 'Card') {
      if (context.delegatedCardMode === delegatedCardModes[0]) {
        const body = params.cardBody?.trim() ?? ''
        if (!body) {
          errors.cardBody = 'Card message is required'
        }
      } else {
        const raw = params.cardJson?.trim()
        if (!raw) {
          errors.cardJson = 'Card JSON is required'
        } else {
          try {
            const parsed = JSON.parse(raw)
            if (!parsed || typeof parsed !== 'object') {
              errors.cardJson = 'Card JSON must be an object'
            }
          } catch (error) {
            errors.cardJson = 'Card JSON must be valid JSON'
          }
        }
      }
    } else if (!params.message?.trim()) {
      errors.message = 'Message cannot be empty'
    }
  }

  return errors
}

const buildConnectionValue = (scope: ConnectionScope, id: string) =>
  `${scope}:${id}`

const parseConnectionValue = (
  raw: string
): { scope: ConnectionScope; id: string } | null => {
  if (!raw) return null
  const [scopePart, ...rest] = raw.split(':')
  const idPart = rest.join(':')
  if (
    (scopePart === 'personal' || scopePart === 'workspace') &&
    idPart.trim()
  ) {
    return { scope: scopePart, id: idPart.trim() }
  }
  return null
}

export default function TeamsAction({
  nodeId,
  canEdit = true,
  isRestricted = false
}: TeamsActionProps) {
  const params = useActionParams<Record<string, unknown>>(nodeId, 'teams')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && !isRestricted && storeCanEdit

  const rawTeamsParams = useMemo<TeamsActionValues>(
    () => extractTeamsParams(params),
    [params]
  )

  const currentParams = useMemo(
    () => normalizeParams(rawTeamsParams),
    [rawTeamsParams]
  )

  const paramContext = useMemo(
    () => deriveParamContext(currentParams),
    [currentParams]
  )

  const {
    isIncomingWebhook,
    isDelegated,
    isConnector,
    isWorkflow,
    workflowOption,
    workflowUsesHeaderSecret,
    delegatedMessageType,
    delegatedCardMode
  } = paramContext

  const [connectionsFetched, setConnectionsFetched] = useState(false)
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [microsoftConnections, setMicrosoftConnections] =
    useState<ProviderConnectionSet | null>(null)

  useEffect(() => {
    if (isDelegated) return

    setMicrosoftConnections((prev) => (prev === null ? prev : null))
    setConnectionsFetched((prev) => (prev ? false : prev))
    setConnectionsLoading(false)
    setConnectionsError((prev) => (prev === null ? prev : null))
    setTeams((prev) => (prev.length === 0 ? prev : []))
    setTeamsLoading(false)
    setTeamsError((prev) => (prev === null ? prev : null))
    setChannels((prev) => (prev.length === 0 ? prev : []))
    setChannelsLoading(false)
    setChannelsError((prev) => (prev === null ? prev : null))
    setMembers((prev) => (prev.length === 0 ? prev : []))
    setMembersLoading(false)
    setMembersError((prev) => (prev === null ? prev : null))
  }, [isDelegated])

  const sanitizeConnections = useCallback(
    (connections: ProviderConnectionSet | null) => {
      if (!connections) return null
      const personal = { ...connections.personal }
      if (personal.requiresReconnect) {
        personal.connected = false
        personal.id = null
      }
      const workspace = connections.workspace
        .filter((entry) => !entry.requiresReconnect)
        .map((entry) => ({ ...entry }))
      return {
        personal,
        workspace
      }
    },
    []
  )

  const syncMicrosoftConnections = useCallback(
    (incoming: ProviderConnectionSet | null) => {
      const sanitized = sanitizeConnections(incoming)
      setMicrosoftConnections((prev) => {
        if (prev === sanitized) {
          return prev
        }
        if (!prev || !sanitized) {
          return sanitized ?? null
        }
        return deepEqual(prev, sanitized) ? prev : sanitized
      })
    },
    [sanitizeConnections]
  )

  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null

  const [teams, setTeams] = useState<MicrosoftTeam[]>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [teamsError, setTeamsError] = useState<string | null>(null)

  const [channels, setChannels] = useState<MicrosoftChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [channelsError, setChannelsError] = useState<string | null>(null)

  const [members, setMembers] = useState<MicrosoftChannelMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState<string | null>(null)

  const [teamsRequestId, setTeamsRequestId] = useState(0)
  const [channelsRequestId, setChannelsRequestId] = useState(0)
  const [membersRequestId, setMembersRequestId] = useState(0)
  const findConnectionById = useCallback(
    (scope?: ConnectionScope | null, id?: string | null) => {
      if (!microsoftConnections || !scope || !id) return null
      if (scope === 'personal') {
        const personal = microsoftConnections.personal
        if (!personal.connected || !personal.id) return null
        if (id === 'microsoft' || personal.id === id) {
          return personal
        }
        return null
      }

      return (
        microsoftConnections.workspace.find((entry) => entry.id === id) ?? null
      )
    },
    [microsoftConnections]
  )

  const findConnectionByEmail = useCallback(
    (email?: string | null) => {
      if (!microsoftConnections) return null
      const normalized = email?.trim().toLowerCase()
      if (!normalized) return null

      const personal = microsoftConnections.personal
      if (
        personal.connected &&
        personal.accountEmail &&
        personal.accountEmail.trim().toLowerCase() === normalized
      ) {
        return personal
      }

      return (
        microsoftConnections.workspace.find(
          (entry) =>
            entry.accountEmail &&
            entry.accountEmail.trim().toLowerCase() === normalized
        ) ?? null
      )
    },
    [microsoftConnections]
  )

  const connectionChoices = useMemo(() => {
    if (!microsoftConnections)
      return [] as (
        | ProviderConnectionSet['personal']
        | ProviderConnectionSet['workspace'][number]
      )[]

    const entries: (
      | ProviderConnectionSet['personal']
      | ProviderConnectionSet['workspace'][number]
    )[] = []
    const personal = microsoftConnections.personal
    if (personal.connected && personal.id) {
      entries.push(personal)
    }
    for (const entry of microsoftConnections.workspace) {
      if (entry.id) {
        entries.push(entry)
      }
    }
    return entries
  }, [microsoftConnections])

  const hasMicrosoftAccount = connectionChoices.length > 0

  const sanitizeState = useCallback(
    (params: TeamsActionValues, context?: TeamsParamContext) => {
      const normalized = normalizeParams(params)
      const effectiveContext = context ?? deriveParamContext(normalized)
      const sanitizedForContext = sanitizeForSelection(normalized, {
        isIncomingWebhook: effectiveContext.isIncomingWebhook,
        isDelegated: effectiveContext.isDelegated,
        isConnector: effectiveContext.isConnector,
        isWorkflow: effectiveContext.isWorkflow,
        workflowUsesHeaderSecret: effectiveContext.workflowUsesHeaderSecret,
        delegatedMessageType: effectiveContext.delegatedMessageType,
        delegatedCardMode: effectiveContext.delegatedCardMode
      })

      const selection = sanitizedForContext.connection
        ? cloneConnectionSelection(sanitizedForContext.connection)
        : null
      const sanitizedWithSelection = applyConnectionSelection(
        sanitizedForContext,
        selection ?? null
      )

      const mentions = (sanitizedWithSelection.mentions ?? []).map(
        (mention) => ({
          ...mention
        })
      )

      const sanitized: TeamsActionValues = {
        ...sanitizedWithSelection,
        mentions
      }

      if (selection) {
        sanitized.connection = selection
      } else if ('connection' in sanitized) {
        delete (sanitized as Record<string, unknown>).connection
      }

      return { params: sanitized, context: effectiveContext }
    },
    []
  )

  const sanitizedParams = useMemo(
    () => sanitizeState(currentParams, paramContext).params,
    [currentParams, paramContext, sanitizeState]
  )

  const validationErrors = useMemo(
    () =>
      validateTeamsParams(sanitizedParams, paramContext, {
        connectionsError,
        connectionsLoading,
        connectionChoices,
        hasMicrosoftAccount,
        teamsError,
        teamsLoading,
        channelsError,
        channelsLoading
      }),
    [
      channelsError,
      channelsLoading,
      connectionChoices,
      connectionsError,
      connectionsLoading,
      sanitizedParams,
      hasMicrosoftAccount,
      paramContext,
      teamsError,
      teamsLoading
    ]
  )

  const computeValidationFor = useCallback(
    (nextParams: TeamsActionValues) => {
      const context = deriveParamContext(nextParams)
      return validateTeamsParams(nextParams, context, {
        connectionsError,
        connectionsLoading,
        connectionChoices,
        hasMicrosoftAccount,
        teamsError,
        teamsLoading,
        channelsError,
        channelsLoading
      })
    },
    [
      channelsError,
      channelsLoading,
      connectionChoices,
      connectionsError,
      connectionsLoading,
      hasMicrosoftAccount,
      teamsError,
      teamsLoading
    ]
  )

  const commitTeamsParams = useCallback(
    (
      nextState: TeamsActionValues,
      { markDirty = true }: { markDirty?: boolean } = {}
    ) => {
      if (!effectiveCanEdit) return

      const { params: nextParams } = sanitizeState(nextState)
      if (deepEqual(sanitizedParams, nextParams)) {
        return
      }

      const nextErrors = computeValidationFor(nextParams)

      updateNodeData(nodeId, {
        params: nextParams,
        ...(markDirty ? { dirty: true } : {}),
        hasValidationErrors: Object.keys(nextErrors).length > 0
      })
    },
    [
      computeValidationFor,
      effectiveCanEdit,
      nodeId,
      sanitizedParams,
      sanitizeState,
      updateNodeData
    ]
  )

  const mergeTeamsParams = useCallback(
    (patch: Partial<TeamsActionValues>, options?: { markDirty?: boolean }) => {
      if (!effectiveCanEdit) return
      commitTeamsParams({ ...sanitizedParams, ...patch }, options)
    },
    [commitTeamsParams, effectiveCanEdit, sanitizedParams]
  )

  const lastValidationStateRef = useRef<boolean | null>(null)

  useEffect(() => {
    const hasErrors = Object.keys(validationErrors).length > 0
    if (lastValidationStateRef.current === hasErrors) return
    lastValidationStateRef.current = hasErrors
    updateNodeData(nodeId, { hasValidationErrors: hasErrors })
  }, [nodeId, updateNodeData, validationErrors])

  const selectedConnection = useMemo(() => {
    const scope =
      currentParams.oauthConnectionScope === 'personal' ||
      currentParams.oauthConnectionScope === 'workspace'
        ? (currentParams.oauthConnectionScope as ConnectionScope)
        : undefined
    const id = currentParams.oauthConnectionId?.trim() || undefined
    return findConnectionById(scope, id)
  }, [
    currentParams.oauthConnectionId,
    currentParams.oauthConnectionScope,
    findConnectionById
  ])

  const connectionRequestOptions = useMemo<
    MicrosoftConnectionOptions | undefined
  >(() => {
    if (!selectedConnection) {
      return undefined
    }

    if (selectedConnection.scope === 'workspace') {
      const id = selectedConnection.id?.trim()
      if (!id) {
        return undefined
      }
      return { scope: 'workspace', connectionId: id }
    }

    if (selectedConnection.scope === 'personal') {
      return { scope: 'personal' }
    }

    return undefined
  }, [selectedConnection])

  useEffect(() => {
    if (!isDelegated) return

    let active = true

    const cached = getCachedConnections(workspaceId)
    if (cached?.microsoft) {
      syncMicrosoftConnections(cached.microsoft)
      setConnectionsError(null)
      setConnectionsLoading(false)
      setConnectionsFetched(true)
    } else {
      syncMicrosoftConnections(null)
    }

    const unsubscribe = subscribeToConnectionUpdates(
      (snapshot) => {
        if (!active) return
        const microsoft = snapshot?.microsoft ?? null
        if (!microsoft) {
          syncMicrosoftConnections(null)
          setConnectionsLoading(false)
          setConnectionsFetched(true)
          return
        }
        syncMicrosoftConnections(microsoft)
        setConnectionsError(null)
        setConnectionsLoading(false)
        setConnectionsFetched(true)
      },
      { workspaceId }
    )

    if (!cached && !connectionsFetched) {
      setConnectionsLoading(true)
      setConnectionsError(null)
      fetchConnections({ workspaceId })
        .then((data) => {
          if (!active) return
          syncMicrosoftConnections(data.microsoft ?? null)
          setConnectionsError(null)
        })
        .catch((error) => {
          if (!active) return
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to load Microsoft integrations'
          setConnectionsError(message)
          syncMicrosoftConnections(null)
        })
        .finally(() => {
          if (!active) return
          setConnectionsLoading(false)
          setConnectionsFetched(true)
        })
    }

    return () => {
      active = false
      unsubscribe()
    }
  }, [isDelegated, connectionsFetched, syncMicrosoftConnections, workspaceId])

  useEffect(() => {
    if (!effectiveCanEdit) return

    const baseParams = sanitizedParams
    const existingSelection = (() => {
      if (baseParams.connection) {
        return cloneConnectionSelection(baseParams.connection)
      }
      const derived = buildConnectionSelectionFromParts(
        baseParams.oauthConnectionScope,
        baseParams.oauthConnectionId,
        baseParams.oauthAccountEmail
      )
      return derived ?? undefined
    })()

    const commitIfChanged = (
      nextState: TeamsActionValues,
      options?: { markDirty?: boolean }
    ) => {
      const { params: normalized } = sanitizeState(nextState, paramContext)
      if (Object.keys(computeTeamsPatch(baseParams, normalized)).length === 0) {
        return
      }
      commitTeamsParams(normalized, options)
    }

    const clearSelection = () => {
      const cleared = applyConnectionSelection(baseParams, null)
      cleared.oauthProvider = 'microsoft'
      commitIfChanged(cleared, { markDirty: false })
    }

    if (!isDelegated) {
      clearSelection()
      return
    }

    if (!microsoftConnections) return

    const rawScope = baseParams.oauthConnectionScope
    const scope =
      rawScope === 'personal' || rawScope === 'workspace'
        ? (rawScope as ConnectionScope)
        : undefined
    const id = baseParams.oauthConnectionId?.trim() || undefined
    const email = baseParams.oauthAccountEmail?.trim() || undefined

    let selected = findConnectionById(scope, id)
    if (!selected && email) {
      selected = findConnectionByEmail(email)
    }
    const wasWorkspaceSelection = scope === 'workspace'

    if (!selected && wasWorkspaceSelection) {
      clearSelection()
      return
    }
    if (!selected) {
      const personal = microsoftConnections.personal
      if (personal.connected && personal.id) {
        selected = personal
      }
    }
    if (
      !selected &&
      !wasWorkspaceSelection &&
      microsoftConnections.workspace.length === 1
    ) {
      selected = microsoftConnections.workspace[0]
    }

    if (!selected) {
      clearSelection()
      return
    }

    const selection = connectionInfoToSelection(selected)
    if (!selection) {
      clearSelection()
      return
    }

    if (selectionsEqual(existingSelection, selection)) {
      return
    }

    commitIfChanged(applyConnectionSelection(baseParams, selection), {
      markDirty: false
    })
  }, [
    commitTeamsParams,
    effectiveCanEdit,
    findConnectionByEmail,
    findConnectionById,
    isDelegated,
    microsoftConnections,
    paramContext,
    sanitizedParams,
    sanitizeState
  ])

  useEffect(() => {
    if (!isDelegated || !hasMicrosoftAccount || !connectionRequestOptions) {
      setTeams((prev) => (prev.length > 0 ? [] : prev))
      setTeamsError((prev) => (prev === null ? prev : null))
      return
    }

    let active = true
    setTeamsLoading(true)
    setTeamsError(null)

    fetchMicrosoftTeams(connectionRequestOptions)
      .then((data) => {
        if (!active) return
        setTeams(data)
      })
      .catch((error) => {
        if (!active) return
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load Microsoft Teams'
        setTeams([])
        setTeamsError(message)
      })
      .finally(() => {
        if (!active) return
        setTeamsLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    isDelegated,
    hasMicrosoftAccount,
    connectionRequestOptions,
    teamsRequestId
  ])

  useEffect(() => {
    if (
      !isDelegated ||
      !hasMicrosoftAccount ||
      !currentParams.teamId ||
      !connectionRequestOptions
    ) {
      setChannels((prev) => (prev.length > 0 ? [] : prev))
      setChannelsError((prev) => (prev === null ? prev : null))
      return
    }

    let active = true
    setChannelsLoading(true)
    setChannelsError(null)

    fetchMicrosoftTeamChannels(currentParams.teamId, connectionRequestOptions)
      .then((data) => {
        if (!active) return
        setChannels(data)
      })
      .catch((error) => {
        if (!active) return
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load Teams channels'
        setChannels([])
        setChannelsError(message)
      })
      .finally(() => {
        if (!active) return
        setChannelsLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    connectionRequestOptions,
    currentParams.teamId,
    hasMicrosoftAccount,
    isDelegated,
    channelsRequestId
  ])

  useEffect(() => {
    if (
      !isDelegated ||
      !hasMicrosoftAccount ||
      !currentParams.teamId ||
      !currentParams.channelId ||
      !connectionRequestOptions
    ) {
      setMembers((prev) => (prev.length > 0 ? [] : prev))
      setMembersError((prev) => (prev === null ? prev : null))
      return
    }

    let active = true
    setMembersLoading(true)
    setMembersError(null)

    fetchMicrosoftChannelMembers(
      currentParams.teamId,
      currentParams.channelId,
      connectionRequestOptions
    )
      .then((data) => {
        if (!active) return
        setMembers(data)
      })
      .catch((error) => {
        if (!active) return
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load channel members'
        setMembers([])
        setMembersError(message)
      })
      .finally(() => {
        if (!active) return
        setMembersLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    connectionRequestOptions,
    currentParams.channelId,
    currentParams.teamId,
    hasMicrosoftAccount,
    isDelegated,
    membersRequestId
  ])

  const updateField = useCallback(
    (key: keyof TeamsActionValues, value: string) => {
      const currentValue = (currentParams[key] ?? '') as string
      if (typeof currentValue === 'string' && currentValue === value) return
      mergeTeamsParams({ [key]: value } as Partial<TeamsActionValues>)
    },
    [currentParams, mergeTeamsParams]
  )

  const handleTeamChange = useCallback(
    (teamId: string) => {
      const selected = teams.find((team) => team.id === teamId)
      mergeTeamsParams({
        teamId,
        teamName: selected?.displayName ?? '',
        channelId: '',
        channelName: '',
        mentions: []
      })
    },
    [mergeTeamsParams, teams]
  )

  const handleChannelChange = useCallback(
    (channelId: string) => {
      const selected = channels.find((channel) => channel.id === channelId)
      mergeTeamsParams({
        channelId,
        channelName: selected?.displayName ?? '',
        mentions: []
      })
    },
    [channels, mergeTeamsParams]
  )

  const handleMessageTypeChange = useCallback(
    (value: string) => {
      const nextType = delegatedMessageTypes.includes(
        value as DelegatedMessageType
      )
        ? (value as DelegatedMessageType)
        : delegatedMessageTypes[0]
      if (nextType === delegatedMessageType) return
      mergeTeamsParams({ messageType: nextType })
    },
    [delegatedMessageType, mergeTeamsParams]
  )

  const handleCardModeChange = useCallback(
    (value: string) => {
      const nextMode = delegatedCardModes.includes(value as DelegatedCardMode)
        ? (value as DelegatedCardMode)
        : delegatedCardModes[0]
      if (nextMode === delegatedCardMode) return

      if (nextMode === delegatedCardModes[1]) {
        const baseParams = sanitizedParams
        const generated = buildSimpleAdaptiveCardJson(
          baseParams.cardTitle ?? '',
          baseParams.cardBody ?? ''
        )
        const fallback = baseParams.cardJson?.trim() || ''
        mergeTeamsParams({
          cardMode: nextMode,
          cardJson: generated || fallback
        })
        return
      }

      mergeTeamsParams({ cardMode: nextMode })
    },
    [delegatedCardMode, mergeTeamsParams, sanitizedParams]
  )

  const handleMentionToggle = useCallback(
    (member: MicrosoftChannelMember) => {
      const currentMentions = sanitizedParams.mentions ?? []
      const exists = currentMentions.some(
        (mention) => mention.userId === member.userId
      )

      if (exists) {
        mergeTeamsParams({
          mentions: currentMentions.filter(
            (mention) => mention.userId !== member.userId
          )
        })
        return
      }

      const displayName =
        member.displayName?.trim() || member.email?.trim() || member.userId

      mergeTeamsParams({
        mentions: [...currentMentions, { userId: member.userId, displayName }]
      })
    },
    [mergeTeamsParams, sanitizedParams]
  )

  const errorClass = 'text-xs text-red-500'
  const helperClass = 'text-[10px] text-zinc-500 dark:text-zinc-400'

  const mentionSelections = useMemo(() => {
    const selections = new Set(
      (currentParams.mentions ?? []).map((m) => m.userId)
    )
    return selections
  }, [currentParams.mentions])

  const connectionOptionGroups = useMemo<NodeDropdownOptionGroup[]>(() => {
    if (!microsoftConnections) return []
    const groups: NodeDropdownOptionGroup[] = []
    const personal = microsoftConnections.personal
    if (personal.connected && personal.id) {
      groups.push({
        label: 'Your connections',
        options: [
          {
            value: buildConnectionValue('personal', personal.id),
            label: personal.accountEmail?.trim() || 'Personal Microsoft account'
          }
        ]
      })
    }

    const workspaceOptions = microsoftConnections.workspace
      .filter((entry) => typeof entry.id === 'string' && entry.id)
      .map((entry) => {
        const id = entry.id as string
        const workspaceName = entry.workspaceName?.trim()
        const accountEmail = entry.accountEmail?.trim()
        const label = workspaceName
          ? accountEmail
            ? `${workspaceName} · ${accountEmail}`
            : `${workspaceName} credential`
          : accountEmail || 'Workspace credential'
        return {
          value: buildConnectionValue('workspace', id),
          label
        }
      })

    if (workspaceOptions.length > 0) {
      groups.push({
        label: 'Workspace connections',
        options: workspaceOptions
      })
    }

    return groups
  }, [microsoftConnections])

  const selectedConnectionValue = useMemo(() => {
    const scope = currentParams.oauthConnectionScope
    let id = currentParams.oauthConnectionId
    if (scope === 'personal' && id === 'microsoft') {
      const personalId = microsoftConnections?.personal.id
      if (personalId) {
        id = personalId
      }
    }
    if (scope !== 'personal' && scope !== 'workspace') return ''
    if (!id) return ''
    return buildConnectionValue(scope, id)
  }, [
    currentParams.oauthConnectionId,
    currentParams.oauthConnectionScope,
    microsoftConnections?.personal?.id
  ])

  const handleConnectionChange = useCallback(
    (value: string) => {
      const baseParams = sanitizedParams
      const parsed = parseConnectionValue(value)
      if (!parsed) {
        const cleared = applyConnectionSelection(baseParams, null)
        cleared.oauthProvider = 'microsoft'
        commitTeamsParams(cleared)
        return
      }

      const match = findConnectionById(parsed.scope, parsed.id)
      const selection =
        (match ? connectionInfoToSelection(match) : null) ??
        buildConnectionSelectionFromParts(
          parsed.scope,
          parsed.id,
          match?.accountEmail
        )

      if (!selection) {
        const cleared = applyConnectionSelection(baseParams, null)
        cleared.oauthProvider = 'microsoft'
        commitTeamsParams(cleared)
        return
      }

      const nextParams = applyConnectionSelection(baseParams, selection)
      commitTeamsParams(nextParams)
    },
    [commitTeamsParams, findConnectionById, sanitizedParams]
  )

  const usingWorkspaceCredential = selectedConnection?.scope === 'workspace'

  const teamsOptions = useMemo(
    () =>
      teams.map((team) => ({
        value: team.id,
        label: team.displayName
      })),
    [teams]
  )

  const channelsOptions = useMemo(
    () =>
      channels.map((channel) => ({
        value: channel.id,
        label: channel.displayName
      })),
    [channels]
  )

  return (
    <div className="flex flex-col gap-2">
      <NodeDropdownField
        options={[...deliveryOptions]}
        value={currentParams.deliveryMethod}
        onChange={(val) => updateField('deliveryMethod', val)}
      />
      {validationErrors.deliveryMethod && (
        <p className={errorClass}>{validationErrors.deliveryMethod}</p>
      )}
      {!isIncomingWebhook && !isDelegated && (
        <p className={helperClass}>
          Teams bots and additional delivery methods are coming soon. Use an
          incoming webhook or delegated OAuth to send messages today.
        </p>
      )}

      {isIncomingWebhook && (
        <div className="flex flex-col gap-2">
          <NodeDropdownField
            options={webhookOptions}
            value={currentParams.webhookType}
            onChange={(val) => updateField('webhookType', val)}
          />
          {validationErrors.webhookType && (
            <p className={errorClass}>{validationErrors.webhookType}</p>
          )}

          <>
            <NodeInputField
              placeholder="Webhook URL"
              value={currentParams.webhookUrl || ''}
              onChange={(val) => updateField('webhookUrl', val)}
            />
            {validationErrors.webhookUrl && (
              <p className={errorClass}>{validationErrors.webhookUrl}</p>
            )}
          </>

          {isConnector && (
            <>
              <NodeInputField
                placeholder="Card Title (optional)"
                value={currentParams.title || ''}
                onChange={(val) => updateField('title', val)}
              />
              <NodeInputField
                placeholder="Summary (optional)"
                value={currentParams.summary || ''}
                onChange={(val) => updateField('summary', val)}
              />
              <NodeInputField
                placeholder="Theme Color (hex, optional)"
                value={currentParams.themeColor || ''}
                onChange={(val) => updateField('themeColor', val)}
              />
              {validationErrors.themeColor && (
                <p className={errorClass}>{validationErrors.themeColor}</p>
              )}
              <p className={helperClass}>
                Connector webhooks send legacy message cards. Leave optional
                fields blank for a simple text card.
              </p>

              <NodeInputField
                placeholder="Message"
                value={currentParams.message || ''}
                onChange={(val) => updateField('message', val)}
              />
              {validationErrors.message && (
                <p className={errorClass}>{validationErrors.message}</p>
              )}
            </>
          )}

          {isWorkflow && (
            <>
              <NodeDropdownField
                options={workflowOptions}
                value={workflowOption}
                onChange={(val) => updateField('workflowOption', val)}
              />
              {validationErrors.workflowOption && (
                <p className={errorClass}>{validationErrors.workflowOption}</p>
              )}

              <NodeTextAreaField
                placeholder="Raw JSON payload"
                value={currentParams.workflowRawJson || ''}
                onChange={(val) => updateField('workflowRawJson', val)}
                rows={8}
              />
              {validationErrors.workflowRawJson && (
                <p className={errorClass}>{validationErrors.workflowRawJson}</p>
              )}
              <p className={helperClass}>
                Paste the exact JSON body that Power Automate should receive.
                Workflow context variables are not expanded automatically for
                these hooks.
              </p>

              {workflowUsesHeaderSecret && (
                <>
                  <NodeInputField
                    placeholder="Header Name"
                    value={currentParams.workflowHeaderName || ''}
                    onChange={(val) => updateField('workflowHeaderName', val)}
                  />
                  {validationErrors.workflowHeaderName && (
                    <p className={errorClass}>
                      {validationErrors.workflowHeaderName}
                    </p>
                  )}
                  <NodeSecretDropdown
                    group="messaging"
                    service="teams"
                    value={currentParams.workflowHeaderSecret || ''}
                    onChange={(val) => updateField('workflowHeaderSecret', val)}
                    placeholder="Select header secret"
                  />
                  {validationErrors.workflowHeaderSecret && (
                    <p className={errorClass}>
                      {validationErrors.workflowHeaderSecret}
                    </p>
                  )}
                  <p className={helperClass}>
                    The header secret will be stored securely and attached to
                    every webhook invocation.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}

      {isDelegated && (
        <div className="flex flex-col gap-2">
          <p className={helperClass}>
            Post messages as the authenticated Microsoft user using delegated
            Graph permissions.
          </p>
          <NodeDropdownField
            options={connectionOptionGroups}
            value={selectedConnectionValue}
            onChange={handleConnectionChange}
            placeholder={
              connectionsLoading
                ? 'Loading Microsoft connections…'
                : connectionOptionGroups.length > 0
                  ? 'Select Microsoft connection'
                  : 'No Microsoft connections available'
            }
            disabled={!hasMicrosoftAccount || connectionsLoading}
            loading={connectionsLoading}
            emptyMessage={
              connectionsError || 'No Microsoft connections connected yet'
            }
          />
          {connectionsError && <p className={errorClass}>{connectionsError}</p>}
          {!connectionsError && validationErrors.oauthConnectionId && (
            <p className={errorClass}>{validationErrors.oauthConnectionId}</p>
          )}
          {!connectionsLoading && !connectionsError && !hasMicrosoftAccount && (
            <p className={helperClass}>
              Connect the Microsoft integration in Settings → Integrations, then
              return to enable delegated messaging.
            </p>
          )}
          {usingWorkspaceCredential &&
            selectedConnection?.scope === 'workspace' && (
              <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700 shadow-sm dark:border-blue-400/60 dark:bg-blue-500/10 dark:text-blue-200">
                This action will run using the workspace credential
                {selectedConnection.workspaceName
                  ? ` "${selectedConnection.workspaceName}"`
                  : ''}
                . Workspace admins manage refresh tokens in Settings →
                Integrations.
              </p>
            )}
          {connectionsError && (
            <button
              type="button"
              className="self-start text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => {
                setConnectionsFetched(false)
              }}
            >
              Retry loading Microsoft accounts
            </button>
          )}

          <NodeDropdownField
            options={teamsOptions}
            value={currentParams.teamId || ''}
            onChange={handleTeamChange}
            placeholder={teamsLoading ? 'Loading teams…' : 'Select team'}
            loading={teamsLoading}
            disabled={!hasMicrosoftAccount || teamsLoading}
            emptyMessage={teamsError || 'No teams available'}
          />
          {validationErrors.teamId && (
            <p className={errorClass}>{validationErrors.teamId}</p>
          )}
          {teamsError && (
            <button
              type="button"
              className="self-start text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => {
                setTeamsRequestId((prev) => prev + 1)
              }}
            >
              Retry loading teams
            </button>
          )}

          <NodeDropdownField
            options={channelsOptions}
            value={currentParams.channelId || ''}
            onChange={handleChannelChange}
            placeholder={
              channelsLoading ? 'Loading channels…' : 'Select channel'
            }
            loading={channelsLoading}
            disabled={!currentParams.teamId || channelsLoading}
            emptyMessage={channelsError || 'No channels available'}
          />
          {validationErrors.channelId && (
            <p className={errorClass}>{validationErrors.channelId}</p>
          )}
          {channelsError && (
            <button
              type="button"
              className="self-start text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => {
                if (!currentParams.teamId) return
                setChannelsRequestId((prev) => prev + 1)
              }}
            >
              Retry loading channels
            </button>
          )}

          <NodeDropdownField
            options={[...delegatedMessageTypes]}
            value={delegatedMessageType}
            onChange={handleMessageTypeChange}
          />

          {delegatedMessageType === 'Text' ? (
            <>
              <NodeTextAreaField
                placeholder="Message"
                value={currentParams.message || ''}
                onChange={(val) => updateField('message', val)}
                rows={5}
              />
              {validationErrors.message && (
                <p className={errorClass}>{validationErrors.message}</p>
              )}
              {membersLoading && (
                <p className={helperClass}>Loading channel members…</p>
              )}
              {membersError && (
                <>
                  <p className={errorClass}>{membersError}</p>
                  {currentParams.channelId && (
                    <button
                      type="button"
                      className="self-start text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                      onClick={() => {
                        setMembersRequestId((prev) => prev + 1)
                      }}
                    >
                      Retry loading members
                    </button>
                  )}
                </>
              )}
              {!membersLoading && !membersError && currentParams.channelId && (
                <div className="rounded border border-zinc-200 bg-white px-2 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <p className="mb-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                    Optional: select members to @mention. Mentions are appended
                    after the message content.
                  </p>
                  {members.length === 0 ? (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      This channel does not list any members you can mention.
                    </p>
                  ) : (
                    <div className="flex max-h-32 flex-col gap-1 overflow-y-auto themed-scroll">
                      {members.map((member) => {
                        const label = member.email
                          ? `${member.displayName} (${member.email})`
                          : member.displayName
                        return (
                          <label
                            key={member.userId}
                            className="flex items-center gap-2 rounded px-1 py-[2px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3"
                              checked={mentionSelections.has(member.userId)}
                              onChange={() => handleMentionToggle(member)}
                            />
                            <span>{label}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <NodeDropdownField
                options={[...delegatedCardModes]}
                value={delegatedCardMode}
                onChange={handleCardModeChange}
              />
              {delegatedCardMode === delegatedCardModes[0] ? (
                <>
                  <NodeInputField
                    placeholder="Card title (optional)"
                    value={currentParams.cardTitle || ''}
                    onChange={(val) => updateField('cardTitle', val)}
                  />
                  <NodeTextAreaField
                    placeholder="Card message"
                    value={currentParams.cardBody || ''}
                    onChange={(val) => updateField('cardBody', val)}
                    rows={5}
                  />
                  {validationErrors.cardBody && (
                    <p className={errorClass}>{validationErrors.cardBody}</p>
                  )}
                  <p className={helperClass}>
                    We'll generate a simple Adaptive Card attachment with this
                    content. Switch to Custom JSON for full control.
                  </p>
                </>
              ) : (
                <>
                  <NodeTextAreaField
                    placeholder="Adaptive Card or JSON payload"
                    value={currentParams.cardJson || ''}
                    onChange={(val) => updateField('cardJson', val)}
                    rows={8}
                  />
                  {validationErrors.cardJson && (
                    <p className={errorClass}>{validationErrors.cardJson}</p>
                  )}
                  <p className={helperClass}>
                    Provide Adaptive Card JSON or a Teams message payload. We'll
                    attach it as a card in the selected channel.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

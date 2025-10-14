import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import { fetchConnections, type ProviderConnection } from '@/lib/oauthApi'
import {
  fetchMicrosoftTeams,
  fetchMicrosoftTeamChannels,
  fetchMicrosoftChannelMembers,
  type MicrosoftTeam,
  type MicrosoftChannel,
  type MicrosoftChannelMember
} from '@/lib/microsoftGraphApi'

export interface TeamsMention {
  userId: string
  displayName?: string
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
  workflowOption?: string
  workflowRawJson?: string
  workflowHeaderName?: string
  workflowHeaderSecret?: string
  oauthProvider?: string
  oauthConnectionId?: string
  oauthAccountEmail?: string
  teamId?: string
  teamName?: string
  channelId?: string
  channelName?: string
  messageType?: string
  mentions?: TeamsMention[]
}

interface TeamsActionProps {
  args: TeamsActionValues
  initialDirty?: boolean
  onChange?: (
    args: TeamsActionValues,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
}

const deliveryOptions = [
  'Incoming Webhook',
  'Teams Bot (Bot Framework)',
  'Delegated OAuth (Post as user)'
]

const webhookOptions = ['Connector', 'Workflow/Power Automate']

const workflowOptions = ['Basic (Raw JSON)', 'Header Secret Auth']

const delegatedMessageTypes = ['Text', 'Card'] as const

type DelegatedMessageType = (typeof delegatedMessageTypes)[number]

const STRING_KEYS: (keyof TeamsActionValues)[] = [
  'deliveryMethod',
  'webhookType',
  'webhookUrl',
  'title',
  'summary',
  'themeColor',
  'message',
  'cardJson',
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

const normalizeParams = (incoming?: TeamsActionValues): TeamsActionValues => {
  const base: TeamsActionValues = {
    deliveryMethod: deliveryOptions[0],
    webhookType: webhookOptions[0],
    webhookUrl: '',
    title: '',
    summary: '',
    themeColor: '',
    message: '',
    cardJson: '',
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
      next[key] = value
    }
  })

  next.mentions = sanitizeMentions(incoming.mentions)

  return next
}

const sanitizeForSelection = (
  current: TeamsActionValues,
  {
    isIncomingWebhook,
    isConnector,
    isWorkflow,
    workflowUsesHeaderSecret,
    isDelegated,
    delegatedMessageType
  }: {
    isIncomingWebhook: boolean
    isConnector: boolean
    isWorkflow: boolean
    workflowUsesHeaderSecret: boolean
    isDelegated: boolean
    delegatedMessageType: DelegatedMessageType
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
    sanitized.oauthAccountEmail = ''
    sanitized.teamId = ''
    sanitized.teamName = ''
    sanitized.channelId = ''
    sanitized.channelName = ''
    sanitized.messageType = delegatedMessageTypes[0]
    sanitized.mentions = []

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
    }

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

    sanitized.oauthProvider = sanitized.oauthProvider?.trim() || 'microsoft'
    sanitized.oauthConnectionId =
      sanitized.oauthConnectionId?.trim() || 'microsoft'
    sanitized.oauthAccountEmail = sanitized.oauthAccountEmail?.trim() || ''
    sanitized.teamId = sanitized.teamId?.trim() || ''
    sanitized.teamName = sanitized.teamName?.trim() || ''
    sanitized.channelId = sanitized.channelId?.trim() || ''
    sanitized.channelName = sanitized.channelName?.trim() || ''

    sanitized.messageType = delegatedMessageType

    if (delegatedMessageType === 'Card') {
      sanitized.message = ''
      sanitized.mentions = []
    } else {
      sanitized.cardJson = ''
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
  sanitized.oauthAccountEmail = ''
  sanitized.teamId = ''
  sanitized.teamName = ''
  sanitized.channelId = ''
  sanitized.channelName = ''
  sanitized.messageType = delegatedMessageTypes[0]
  sanitized.mentions = []

  return sanitized
}

const shallowEqual = (a: TeamsActionValues, b: TeamsActionValues) => {
  const keys = new Set([
    ...(Object.keys(a) as string[]),
    ...(Object.keys(b) as string[])
  ])

  for (const key of keys) {
    const left = (a as Record<string, unknown>)[key]
    const right = (b as Record<string, unknown>)[key]

    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) return false
      if (left.length !== right.length) return false
      for (let idx = 0; idx < left.length; idx += 1) {
        if (JSON.stringify(left[idx]) !== JSON.stringify(right[idx])) {
          return false
        }
      }
      continue
    }

    if (left !== right) return false
  }

  return true
}

const stableSerialize = (value: TeamsActionValues) =>
  JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== 'object') {
      return val
    }

    if (Array.isArray(val)) {
      return val.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return entry
        }

        return Object.keys(entry)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = (entry as Record<string, unknown>)[key]
            return acc
          }, {})
      })
    }

    return Object.keys(val as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (val as Record<string, unknown>)[key]
        return acc
      }, {})
  })

export default function TeamsAction({
  args,
  initialDirty = false,
  onChange
}: TeamsActionProps) {
  // React Flow safe pattern: initialize local state from props exactly once
  // via a ref so downstream effects don't thrash the canvas with resets.
  const initialParamsRef = useRef<TeamsActionValues | null>(null)
  if (!initialParamsRef.current) {
    initialParamsRef.current = normalizeParams(args)
  }

  const [params, setParams] = useState<TeamsActionValues>(
    initialParamsRef.current!
  )
  const lastNormalizedArgsRef = useRef<TeamsActionValues>(
    initialParamsRef.current!
  )
  const lastNormalizedSignatureRef = useRef<string>(
    stableSerialize(initialParamsRef.current!)
  )
  const [dirty, setDirty] = useState(initialDirty)

  const [connectionsFetched, setConnectionsFetched] = useState(false)
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [microsoftConnection, setMicrosoftConnection] =
    useState<ProviderConnection | null>(null)

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
  const internalUpdateRef = useRef(false);

  useEffect(() => {
    const normalized = normalizeParams(args);
    const signature = stableSerialize(normalized);

    if (signature === lastNormalizedSignatureRef.current) return;
    // mark that we're syncing from props, not user input
    internalUpdateRef.current = true;
    lastNormalizedArgsRef.current = normalized;
    lastNormalizedSignatureRef.current = signature;
    setParams(normalized);
  }, [args]);

  useEffect(() => {
    setDirty(initialDirty)
  }, [initialDirty])

  const isIncomingWebhook = params.deliveryMethod === deliveryOptions[0]
  const isDelegated = params.deliveryMethod === deliveryOptions[2]
  const isConnector =
    isIncomingWebhook && params.webhookType === webhookOptions[0]
  const isWorkflow =
    isIncomingWebhook && params.webhookType === webhookOptions[1]

  const workflowOption =
    params.workflowOption && workflowOptions.includes(params.workflowOption)
      ? params.workflowOption
      : workflowOptions[0]
  const workflowUsesHeaderSecret = workflowOption === workflowOptions[1]

  const delegatedMessageType: DelegatedMessageType =
    delegatedMessageTypes.includes(
      (params.messageType as DelegatedMessageType) ?? delegatedMessageTypes[0]
    )
      ? (params.messageType as DelegatedMessageType) || delegatedMessageTypes[0]
      : delegatedMessageTypes[0]

  const hasMicrosoftAccount = Boolean(microsoftConnection?.connected)

  useEffect(() => {
    if (!isDelegated || connectionsFetched) return

    let active = true
    setConnectionsLoading(true)
    setConnectionsError(null)

    fetchConnections()
      .then((data) => {
        if (!active) return
        setMicrosoftConnection(data.microsoft ?? null)
        setConnectionsError(null)
      })
      .catch((error) => {
        if (!active) return
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load Microsoft integrations'
        setConnectionsError(message)
        setMicrosoftConnection(null)
      })
      .finally(() => {
        if (!active) return
        setConnectionsLoading(false)
        setConnectionsFetched(true)
      })

    return () => {
      active = false
    }
  }, [isDelegated, connectionsFetched])

  useEffect(() => {
    if (!isDelegated || !hasMicrosoftAccount) return

    setParams((prev) => {
      const nextProvider = 'microsoft'
      const nextConnectionId = prev.oauthConnectionId?.trim() || 'microsoft'
      const nextEmail =
        microsoftConnection?.accountEmail?.trim() ||
        prev.oauthAccountEmail ||
        ''

      if (
        prev.oauthProvider === nextProvider &&
        prev.oauthConnectionId === nextConnectionId &&
        prev.oauthAccountEmail === nextEmail
      ) {
        return prev
      }

      return {
        ...prev,
        oauthProvider: nextProvider,
        oauthConnectionId: nextConnectionId,
        oauthAccountEmail: nextEmail
      }
    })
  }, [isDelegated, hasMicrosoftAccount, microsoftConnection])

  useEffect(() => {
    if (!isDelegated || !hasMicrosoftAccount) {
      setTeams((prev) => (prev.length > 0 ? [] : prev))
      setTeamsError((prev) => (prev === null ? prev : null))
      return
    }

    let active = true
    setTeamsLoading(true)
    setTeamsError(null)

    fetchMicrosoftTeams()
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
  }, [isDelegated, hasMicrosoftAccount, teamsRequestId])

  useEffect(() => {
    if (!isDelegated || !hasMicrosoftAccount || !params.teamId) {
      setChannels((prev) => (prev.length > 0 ? [] : prev))
      setChannelsError((prev) => (prev === null ? prev : null))
      return
    }

    let active = true
    setChannelsLoading(true)
    setChannelsError(null)

    fetchMicrosoftTeamChannels(params.teamId)
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
  }, [isDelegated, hasMicrosoftAccount, params.teamId, channelsRequestId])

  useEffect(() => {
    if (
      !isDelegated ||
      !hasMicrosoftAccount ||
      !params.teamId ||
      !params.channelId
    ) {
      setMembers((prev) => (prev.length > 0 ? [] : prev))
      setMembersError((prev) => (prev === null ? prev : null))
      return
    }

    let active = true
    setMembersLoading(true)
    setMembersError(null)

    fetchMicrosoftChannelMembers(params.teamId, params.channelId)
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
    isDelegated,
    hasMicrosoftAccount,
    params.teamId,
    params.channelId,
    membersRequestId
  ])

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}

    const deliveryMethod = params.deliveryMethod?.trim() ?? ''
    if (!deliveryMethod) {
      errors.deliveryMethod = 'Delivery method is required'
    } else if (
      deliveryMethod !== deliveryOptions[0] &&
      deliveryMethod !== deliveryOptions[2]
    ) {
      errors.deliveryMethod =
        'Only incoming webhooks or delegated OAuth are supported'
    }

    if (isIncomingWebhook) {
      if (!params.webhookType?.trim()) {
        errors.webhookType = 'Webhook type is required'
      }
      if (!params.webhookUrl?.trim()) {
        errors.webhookUrl = 'Webhook URL is required'
      }

      if (isConnector && params.themeColor?.trim()) {
        const sanitized = params.themeColor.trim().replace(/^#/, '')
        const hexRegex = /^[0-9a-fA-F]{6}$/
        if (!hexRegex.test(sanitized)) {
          errors.themeColor = 'Theme color must be a 6-digit hex value'
        }
      }

      if (isConnector && !params.message?.trim()) {
        errors.message = 'Message cannot be empty'
      }

      if (isWorkflow) {
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

        if (workflowUsesHeaderSecret) {
          if (!params.workflowHeaderName?.trim()) {
            errors.workflowHeaderName = 'Header name is required'
          }
          if (!params.workflowHeaderSecret?.trim()) {
            errors.workflowHeaderSecret = 'Header secret is required'
          }
        }
      }
    }

    if (isDelegated) {
      if (connectionsError) {
        errors.oauthConnectionId = connectionsError
      } else if (!connectionsLoading && !hasMicrosoftAccount) {
        errors.oauthConnectionId =
          'Connect the Microsoft integration in Settings → Integrations.'
      } else if (hasMicrosoftAccount && !params.oauthConnectionId?.trim()) {
        errors.oauthConnectionId = 'Select a connected Microsoft account'
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

      if (delegatedMessageType === 'Card') {
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
      } else if (!params.message?.trim()) {
        errors.message = 'Message cannot be empty'
      }
    }

    return errors
  }, [
    params,
    isConnector,
    isIncomingWebhook,
    isWorkflow,
    workflowUsesHeaderSecret,
    isDelegated,
    delegatedMessageType,
    connectionsError,
    connectionsLoading,
    hasMicrosoftAccount,
    teamsError,
    teamsLoading,
    channelsError,
    channelsLoading
  ])

  const sanitizedOutput = useMemo(
    () =>
      sanitizeForSelection(params, {
        isIncomingWebhook,
        isConnector,
        isWorkflow,
        workflowUsesHeaderSecret,
        isDelegated,
        delegatedMessageType
      }),
    [
      params,
      isIncomingWebhook,
      isConnector,
      isWorkflow,
      workflowUsesHeaderSecret,
      isDelegated,
      delegatedMessageType
    ]
  )

  const lastEmittedRef = useRef<{
    values: TeamsActionValues
    hasErrors: boolean
    dirty: boolean
  } | null>(null)

  useEffect(() => {
    if (!onChange) return;

    // if this update came from args sync, skip one emission
    if (internalUpdateRef.current) {
      internalUpdateRef.current = false;
      return;
    }

    const hasErrors = Object.keys(validationErrors).length > 0;
    const last = lastEmittedRef.current;

    if (
      last &&
      last.dirty === dirty &&
      last.hasErrors === hasErrors &&
      shallowEqual(last.values, sanitizedOutput)
    ) {
      return;
    }

    lastEmittedRef.current = {
      values: {
        ...sanitizedOutput,
        mentions: (sanitizedOutput.mentions ?? []).map((m) => ({ ...m }))
      },
      hasErrors,
      dirty
    };

    onChange(sanitizedOutput, hasErrors, dirty);
  }, [dirty, onChange, sanitizedOutput, validationErrors]);

  const updateField = useCallback(
    (key: keyof TeamsActionValues, value: string) => {
      setDirty(true)
      setParams((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const handleTeamChange = useCallback(
    (teamId: string) => {
      setDirty(true)
      setParams((prev) => {
        const selected = teams.find((team) => team.id === teamId)
        return {
          ...prev,
          teamId,
          teamName: selected?.displayName ?? '',
          channelId: '',
          channelName: '',
          mentions: []
        }
      })
    },
    [teams]
  )

  const handleChannelChange = useCallback(
    (channelId: string) => {
      setDirty(true)
      setParams((prev) => {
        const selected = channels.find((channel) => channel.id === channelId)
        return {
          ...prev,
          channelId,
          channelName: selected?.displayName ?? '',
          mentions: []
        }
      })
    },
    [channels]
  )

  const handleMessageTypeChange = useCallback(
    (value: string) => {
      const nextType = delegatedMessageTypes.includes(
        value as DelegatedMessageType
      )
        ? (value as DelegatedMessageType)
        : delegatedMessageTypes[0]
      if (nextType === delegatedMessageType) return
      setDirty(true)
      setParams((prev) => ({ ...prev, messageType: nextType }))
    },
    [delegatedMessageType]
  )

  const handleMentionToggle = useCallback((member: MicrosoftChannelMember) => {
    setDirty(true)
    setParams((prev) => {
      const current = prev.mentions ?? []
      const exists = current.some((mention) => mention.userId === member.userId)
      if (exists) {
        return {
          ...prev,
          mentions: current.filter(
            (mention) => mention.userId !== member.userId
          )
        }
      }

      const displayName =
        member.displayName?.trim() || member.email?.trim() || member.userId

      return {
        ...prev,
        mentions: [...current, { userId: member.userId, displayName }]
      }
    })
  }, [])

  const errorClass = 'text-xs text-red-500'
  const helperClass = 'text-[10px] text-zinc-500 dark:text-zinc-400'

  const mentionSelections = useMemo(() => {
    const selections = new Set((params.mentions ?? []).map((m) => m.userId))
    return selections
  }, [params.mentions])

  const accountOptions = useMemo(() => {
    if (!hasMicrosoftAccount) return []
    const label = microsoftConnection?.accountEmail
      ? `Microsoft (${microsoftConnection.accountEmail})`
      : 'Microsoft account'
    return [
      {
        value: 'microsoft',
        label
      }
    ]
  }, [hasMicrosoftAccount, microsoftConnection])

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
        options={deliveryOptions}
        value={params.deliveryMethod}
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
            value={params.webhookType}
            onChange={(val) => updateField('webhookType', val)}
          />
          {validationErrors.webhookType && (
            <p className={errorClass}>{validationErrors.webhookType}</p>
          )}

          <>
            <NodeInputField
              placeholder="Webhook URL"
              value={params.webhookUrl || ''}
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
                value={params.title || ''}
                onChange={(val) => updateField('title', val)}
              />
              <NodeInputField
                placeholder="Summary (optional)"
                value={params.summary || ''}
                onChange={(val) => updateField('summary', val)}
              />
              <NodeInputField
                placeholder="Theme Color (hex, optional)"
                value={params.themeColor || ''}
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
                value={params.message || ''}
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
                value={params.workflowRawJson || ''}
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
                    value={params.workflowHeaderName || ''}
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
                    value={params.workflowHeaderSecret || ''}
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
            options={accountOptions}
            value={params.oauthConnectionId || ''}
            onChange={(val) => {
              setDirty(true)
              setParams((prev) => ({
                ...prev,
                oauthProvider: 'microsoft',
                oauthConnectionId: val,
                oauthAccountEmail:
                  microsoftConnection?.accountEmail?.trim() ||
                  prev.oauthAccountEmail ||
                  ''
              }))
            }}
            placeholder={
              connectionsLoading
                ? 'Loading Microsoft accounts…'
                : 'Select Microsoft account'
            }
            disabled={!hasMicrosoftAccount}
            loading={connectionsLoading}
            emptyMessage={
              connectionsError || 'No Microsoft accounts connected yet'
            }
          />
          {validationErrors.oauthConnectionId && (
            <p className={errorClass}>{validationErrors.oauthConnectionId}</p>
          )}
          {!connectionsLoading && !hasMicrosoftAccount && !connectionsError && (
            <p className={helperClass}>
              Connect the Microsoft integration in Settings → Integrations, then
              return to enable delegated messaging.
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
            value={params.teamId || ''}
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
            value={params.channelId || ''}
            onChange={handleChannelChange}
            placeholder={
              channelsLoading ? 'Loading channels…' : 'Select channel'
            }
            loading={channelsLoading}
            disabled={!params.teamId || channelsLoading}
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
                if (!params.teamId) return
                setChannelsRequestId((prev) => prev + 1)
              }}
            >
              Retry loading channels
            </button>
          )}

          <NodeDropdownField
            options={delegatedMessageTypes}
            value={delegatedMessageType}
            onChange={handleMessageTypeChange}
          />

          {delegatedMessageType === 'Text' ? (
            <>
              <NodeTextAreaField
                placeholder="Message"
                value={params.message || ''}
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
                  {params.channelId && (
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
              {!membersLoading && !membersError && params.channelId && (
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
                    <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
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
              <NodeTextAreaField
                placeholder="Adaptive Card or JSON payload"
                value={params.cardJson || ''}
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
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import deepEqual from 'fast-deep-equal'
import NodeDropdownField, {
  type NodeDropdownOptionGroup
} from '@/components/ui/InputFields/NodeDropdownField'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/ui/InputFields/NodeSecretDropdown'
import {
  fetchConnections,
  getCachedConnections,
  subscribeToConnectionUpdates,
  type ConnectionScope,
  type ProviderConnectionSet,
  type GroupedConnectionsSnapshot,
  type OAuthProvider
} from '@/lib/oauthApi'
import { fetchSlackChannels, type SlackChannel } from '@/lib/slackApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

type SlackConnectionScope = 'workspace' | 'user'

export interface SlackConnectionSelection {
  connectionScope: SlackConnectionScope
  connectionId?: string
  accountEmail?: string
}

export interface SlackActionValues {
  channel?: string
  message?: string
  token?: string
  connectionScope?: string
  connectionId?: string
  accountEmail?: string
  connection?: SlackConnectionSelection
}

interface SlackActionProps {
  nodeId: string
  canEdit?: boolean
  isRestricted?: boolean
}

const connectionValueKey = (scope: ConnectionScope, id: string) =>
  `${scope}:${id}`

const parseConnectionValue = (
  raw: string
): { scope: ConnectionScope; id: string } | null => {
  if (!raw) return null
  const [scopePart, ...rest] = raw.split(':')
  const idPart = rest.join(':').trim()
  if (
    (scopePart === 'personal' || scopePart === 'workspace') &&
    idPart.length > 0
  ) {
    return { scope: scopePart, id: idPart }
  }
  return null
}

const normalizeScope = (value?: string | null): SlackConnectionScope | '' => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'workspace') return 'workspace'
  if (trimmed === 'personal' || trimmed === 'user') return 'user'
  return ''
}

const buildSelectionFromValue = (
  value: unknown
): SlackConnectionSelection | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const rawScope = (value as Record<string, unknown>).connectionScope as
    | string
    | undefined
  const scope = normalizeScope(rawScope)
  if (!scope) return null

  const selection: SlackConnectionSelection = { connectionScope: scope }
  const id = (value as Record<string, unknown>).connectionId
  if (typeof id === 'string' && id.trim()) {
    selection.connectionId = id.trim()
  }
  const email = (value as Record<string, unknown>).accountEmail
  if (typeof email === 'string' && email.trim()) {
    selection.accountEmail = email.trim()
  }

  return selection
}

const buildSelectionFromParts = (
  scopeValue?: string,
  idValue?: string,
  emailValue?: string
): SlackConnectionSelection | null => {
  const scope = normalizeScope(scopeValue)
  if (!scope) return null

  const selection: SlackConnectionSelection = { connectionScope: scope }
  const id = idValue?.trim()
  const email = emailValue?.trim()

  if (id) {
    selection.connectionId = id
  }
  if (email) {
    selection.accountEmail = email
  }

  if (!selection.connectionId && !selection.accountEmail) {
    return null
  }

  return selection
}

const cloneSelection = (
  selection?: SlackConnectionSelection | null
): SlackConnectionSelection | undefined => {
  if (!selection) return undefined
  const cloned: SlackConnectionSelection = {
    connectionScope: selection.connectionScope
  }
  if (selection.connectionId) cloned.connectionId = selection.connectionId
  if (selection.accountEmail) cloned.accountEmail = selection.accountEmail
  return cloned
}

const EMPTY_SLACK_PARAMS: SlackActionValues = {
  channel: '',
  message: '',
  token: '',
  connectionScope: '',
  connectionId: '',
  accountEmail: ''
}

const sanitizeSlackPayload = (params: SlackActionValues): SlackActionValues => {
  const sanitized: SlackActionValues = {
    channel: typeof params.channel === 'string' ? params.channel : '',
    message: typeof params.message === 'string' ? params.message : '',
    token: typeof params.token === 'string' ? params.token : '',
    connectionScope:
      typeof params.connectionScope === 'string' ? params.connectionScope : '',
    connectionId:
      typeof params.connectionId === 'string' ? params.connectionId : '',
    accountEmail:
      typeof params.accountEmail === 'string' ? params.accountEmail : ''
  }

  if (params.connection) {
    sanitized.connection = cloneSelection(params.connection)
  }

  return sanitized
}

const extractSlackParams = (source: unknown): SlackActionValues => {
  const base: SlackActionValues = { ...EMPTY_SLACK_PARAMS }
  if (!isRecord(source)) {
    return base
  }

  const record = source as Record<string, unknown>
  const slackRecord = isRecord(record.Slack)
    ? (record.Slack as Record<string, unknown>)
    : isRecord(record.slack)
      ? (record.slack as Record<string, unknown>)
      : record

  if (!isRecord(slackRecord)) {
    return base
  }

  if (typeof slackRecord.channel === 'string') {
    base.channel = slackRecord.channel
  }
  if (typeof slackRecord.message === 'string') {
    base.message = slackRecord.message
  }
  if (typeof slackRecord.token === 'string') {
    base.token = slackRecord.token
  }
  if (typeof slackRecord.connectionScope === 'string') {
    base.connectionScope = slackRecord.connectionScope
  }
  if (typeof slackRecord.connectionId === 'string') {
    base.connectionId = slackRecord.connectionId
  }
  if (typeof slackRecord.accountEmail === 'string') {
    base.accountEmail = slackRecord.accountEmail
  }

  const connectionSelection =
    buildSelectionFromValue(slackRecord.connection) ??
    buildSelectionFromParts(
      slackRecord.connectionScope as string | undefined,
      slackRecord.connectionId as string | undefined,
      slackRecord.accountEmail as string | undefined
    )

  if (connectionSelection) {
    base.connectionScope = connectionSelection.connectionScope
    base.connectionId = connectionSelection.connectionId ?? ''
    base.accountEmail = connectionSelection.accountEmail ?? ''
    base.connection = cloneSelection(connectionSelection)
  }

  return base
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const buildActiveConnection = (
  params: SlackActionValues
): SlackConnectionSelection | null => {
  return (
    buildSelectionFromValue(params.connection) ??
    buildSelectionFromParts(
      params.connectionScope,
      params.connectionId,
      params.accountEmail
    )
  )
}

const validateSlackParams = (params: SlackActionValues) => {
  const activeConnection = buildActiveConnection(params)
  const usingConnection = Boolean(activeConnection)

  const errors: Record<string, string> = {}
  if (!params.channel?.trim()) errors.channel = 'Channel is required'
  if (!params.message?.trim()) errors.message = 'Message cannot be empty'
  if (!usingConnection && !params.token?.trim()) {
    errors.token = 'Slack token is required'
  }
  if (usingConnection && !activeConnection?.connectionId) {
    errors.connection = 'Slack connection is required'
  }

  return {
    errors,
    activeConnection,
    usingConnection,
    hasValidationErrors: Object.keys(errors).length > 0
  }
}

export default function SlackAction({
  nodeId,
  canEdit = true,
  isRestricted = false
}: SlackActionProps) {
  const params = useActionParams<Record<string, unknown>>(nodeId, 'slack')
  // Avoid returning new objects from selectors; use separate primitive selectors
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const effectiveCanEdit = canEdit && !isRestricted && storeCanEdit

  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const slackParams = useMemo(
    () => sanitizeSlackPayload(extractSlackParams(params)),
    [params]
  )

  const validation = useMemo(
    () => validateSlackParams(slackParams),
    [slackParams]
  )
  const {
    errors: validationErrors,
    activeConnection,
    usingConnection
  } = validation
  const activeConnectionId = activeConnection?.connectionId?.trim() ?? ''
  const activeConnectionScope: ConnectionScope =
    activeConnection?.connectionScope === 'workspace' ? 'workspace' : 'personal'

  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null

  const [connectionState, setConnectionState] =
    useState<ProviderConnectionSet | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const refreshRequestIdRef = useRef(0)
  const [channelOptions, setChannelOptions] = useState<
    NodeDropdownOptionGroup[]
  >([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const channelRequestIdRef = useRef(0)

  const pickProviderConnections = useCallback(
    (
      snapshot: GroupedConnectionsSnapshot | null,
      provider: OAuthProvider
    ): ProviderConnectionSet | null => {
      if (!snapshot) return null
      const personalRecord = snapshot.personal.find(
        (p) => p.provider === provider
      )
      const personal = personalRecord
        ? {
            scope: 'personal' as const,
            id: personalRecord.id ?? null,
            connected: Boolean(personalRecord.connected && personalRecord.id),
            accountEmail: personalRecord.accountEmail,
            expiresAt: personalRecord.expiresAt,
            lastRefreshedAt: personalRecord.lastRefreshedAt,
            requiresReconnect: Boolean(personalRecord.requiresReconnect),
            isShared: Boolean(personalRecord.isShared)
          }
        : {
            scope: 'personal' as const,
            id: null,
            connected: false,
            accountEmail: undefined,
            expiresAt: undefined,
            lastRefreshedAt: undefined,
            requiresReconnect: false,
            isShared: false
          }
      const workspace = snapshot.workspace
        .filter((w) => w.provider === provider)
        .map((w) => ({ ...w }))
      return { personal, workspace }
    },
    []
  )

  const sanitizeConnections = useCallback(
    (connections: ProviderConnectionSet | null) => {
      if (!connections) return null
      const personal = { ...connections.personal }
      if (personal.requiresReconnect || !personal.connected || !personal.id) {
        personal.connected = false
        personal.id = personal.id ?? null
      }

      const workspace = connections.workspace
        .filter((entry) => entry.connected && Boolean(entry.id))
        .map((entry) => ({ ...entry }))

      return {
        personal,
        workspace
      }
    },
    []
  )

  const refreshConnections = useCallback(async () => {
    const requestId = refreshRequestIdRef.current + 1
    refreshRequestIdRef.current = requestId
    setConnectionsLoading(true)
    setConnectionsError(null)

    const isStale = () =>
      !mountedRef.current || refreshRequestIdRef.current !== requestId

    try {
      const grouped = await fetchConnections({ workspaceId })
      if (isStale()) {
        return
      }
      const slackConnections = sanitizeConnections(
        pickProviderConnections(grouped, 'slack')
      )
      setConnectionState(slackConnections)
    } catch (err) {
      if (isStale()) {
        return
      }
      setConnectionState(null)
      setConnectionsError(
        err instanceof Error
          ? err.message
          : "We couldn't load your Slack connections. Try again."
      )
    } finally {
      if (!isStale()) {
        setConnectionsLoading(false)
      }
    }
  }, [sanitizeConnections, workspaceId, pickProviderConnections])

  useEffect(() => {
    const cached = pickProviderConnections(
      getCachedConnections(workspaceId),
      'slack'
    )
    setConnectionState(sanitizeConnections(cached))

    const unsubscribe = subscribeToConnectionUpdates(
      (snapshot) => {
        if (!mountedRef.current) return
        const slackConnections = pickProviderConnections(snapshot, 'slack')
        setConnectionState(sanitizeConnections(slackConnections))
      },
      { workspaceId }
    )

    refreshConnections()

    return () => {
      unsubscribe()
    }
  }, [
    refreshConnections,
    sanitizeConnections,
    workspaceId,
    pickProviderConnections
  ])

  const findConnectionByValue = useCallback(
    (scope: ConnectionScope, id: string): SlackConnectionSelection | null => {
      if (!connectionState) return null
      if (scope === 'personal') {
        const personal = connectionState.personal
        if (personal.connected && personal.id === id) {
          const selection: SlackConnectionSelection = {
            connectionScope: 'user',
            connectionId: id
          }
          if (personal.accountEmail) {
            selection.accountEmail = personal.accountEmail
          }
          return selection
        }
        return null
      }

      const workspaceEntry = connectionState.workspace.find(
        (entry) => entry.connected && entry.id === id
      )
      if (!workspaceEntry) return null

      const selection: SlackConnectionSelection = {
        connectionScope: 'workspace',
        connectionId: id
      }
      if (workspaceEntry.accountEmail) {
        selection.accountEmail = workspaceEntry.accountEmail
      }
      return selection
    },
    [connectionState]
  )

  const connectionOptions = useMemo<NodeDropdownOptionGroup[]>(() => {
    const groups: NodeDropdownOptionGroup[] = [
      {
        label: 'Authentication',
        options: [
          {
            label: 'Use manual Slack token',
            value: 'manual'
          }
        ]
      }
    ]

    if (!connectionState) {
      return groups
    }

    const personal = connectionState.personal
    if (personal.connected && personal.id) {
      groups.push({
        label: 'Personal connections',
        options: [
          {
            label: personal.accountEmail
              ? `Personal – ${personal.accountEmail}`
              : 'Personal Slack account',
            value: connectionValueKey('personal', personal.id)
          }
        ]
      })
    }

    const workspaceOptions = connectionState.workspace
      .filter((entry) => entry.connected && entry.id)
      .map((entry) => ({
        label: entry.accountEmail
          ? `${entry.workspaceName ?? 'Workspace connection'} – ${entry.accountEmail}`
          : (entry.workspaceName ?? 'Workspace connection'),
        value: connectionValueKey('workspace', entry.id!)
      }))

    if (workspaceOptions.length > 0) {
      groups.push({
        label: 'Workspace connections',
        options: workspaceOptions
      })
    }

    return groups
  }, [connectionState])

  const hasOAuthConnections = useMemo(() => {
    if (!connectionState) return false
    const personal = connectionState.personal
    const personalAvailable = personal.connected && Boolean(personal.id)
    const workspaceAvailable = connectionState.workspace.some(
      (entry) => entry.connected && Boolean(entry.id)
    )
    return personalAvailable || workspaceAvailable
  }, [connectionState])

  const buildChannelOptions = useCallback(
    (channels: SlackChannel[]): NodeDropdownOptionGroup[] => {
      if (!channels.length) return []

      const makeLabel = (channel: SlackChannel) => {
        const base = channel.name.startsWith('#')
          ? channel.name
          : `#${channel.name}`
        return channel.isPrivate ? `${base} (private)` : base
      }

      const publicChannels = channels.filter(
        (channel) => channel.isPrivate !== true
      )
      const privateChannels = channels.filter(
        (channel) => channel.isPrivate === true
      )

      const groups: NodeDropdownOptionGroup[] = []

      if (publicChannels.length > 0) {
        groups.push({
          label: 'Public channels',
          options: publicChannels.map((channel) => ({
            label: makeLabel(channel),
            value: channel.id
          }))
        })
      }

      if (privateChannels.length > 0) {
        groups.push({
          label: 'Private channels',
          options: privateChannels.map((channel) => ({
            label: makeLabel(channel),
            value: channel.id
          }))
        })
      }

      if (groups.length === 0) {
        return [
          {
            label: 'Channels',
            options: channels.map((channel) => ({
              label: makeLabel(channel),
              value: channel.id
            }))
          }
        ]
      }

      return groups
    },
    []
  )

  const selectedConnectionValue = useMemo(() => {
    if (!usingConnection || !activeConnection) return 'manual'
    const id = activeConnection.connectionId?.trim()
    if (!id) return 'manual'
    const scope =
      activeConnection.connectionScope === 'workspace'
        ? 'workspace'
        : 'personal'
    return connectionValueKey(scope, id)
  }, [activeConnection, usingConnection])

  const applySlackPatch = useCallback(
    (patch: Partial<SlackActionValues>) => {
      if (!effectiveCanEdit) return

      const next = sanitizeSlackPayload({ ...slackParams, ...patch })
      if (deepEqual(slackParams, next)) return

      const { hasValidationErrors } = validateSlackParams(next)

      const slackPayload: SlackActionValues = { ...next }
      if (!slackPayload.connection) {
        delete (slackPayload as Record<string, unknown>).connection
      }

      updateNodeData(nodeId, {
        params: slackPayload,
        dirty: true,
        hasValidationErrors
      })
    },
    [effectiveCanEdit, nodeId, slackParams, updateNodeData]
  )

  const handleConnectionChange = useCallback(
    (value: string) => {
      if (value === 'manual') {
        applySlackPatch({
          connectionScope: '',
          connectionId: '',
          accountEmail: '',
          connection: undefined
        })
        return
      }

      const parsed = parseConnectionValue(value)
      if (!parsed) {
        return
      }

      const selection = findConnectionByValue(parsed.scope, parsed.id)
      if (!selection) {
        applySlackPatch({
          connectionScope: '',
          connectionId: '',
          accountEmail: '',
          connection: undefined
        })
        return
      }

      applySlackPatch({
        connectionScope: selection.connectionScope,
        connectionId: selection.connectionId ?? '',
        accountEmail: selection.accountEmail ?? '',
        connection: selection,
        token: ''
      })
    },
    [applySlackPatch, findConnectionByValue]
  )

  const handleChannelChange = useCallback(
    (value: string) => {
      applySlackPatch({ channel: value })
    },
    [applySlackPatch]
  )

  const handleMessageChange = useCallback(
    (value: string) => {
      applySlackPatch({ message: value })
    },
    [applySlackPatch]
  )

  const handleTokenChange = useCallback(
    (value: string) => {
      applySlackPatch({ token: value })
    },
    [applySlackPatch]
  )

  const refreshChannels = useCallback(async () => {
    if (!usingConnection || !activeConnectionId) {
      return
    }

    const requestId = channelRequestIdRef.current + 1
    channelRequestIdRef.current = requestId
    setChannelsLoading(true)
    setChannelsError(null)

    const isStale = () =>
      !mountedRef.current || channelRequestIdRef.current !== requestId

    try {
      const channels = await fetchSlackChannels({
        scope: activeConnectionScope,
        connectionId: activeConnectionId
      })
      if (isStale()) {
        return
      }
      setChannelOptions(buildChannelOptions(channels))

      if (
        slackParams.channel &&
        !channels.some((channel) => channel.id === slackParams.channel)
      ) {
        applySlackPatch({ channel: '' })
      }
    } catch (error) {
      if (isStale()) {
        return
      }
      setChannelOptions([])
      setChannelsError(
        error instanceof Error
          ? error.message
          : "We couldn't load Slack channels. Try again."
      )
    } finally {
      if (!isStale()) {
        setChannelsLoading(false)
      }
    }
  }, [
    activeConnectionId,
    activeConnectionScope,
    applySlackPatch,
    buildChannelOptions,
    slackParams.channel,
    usingConnection
  ])

  useEffect(() => {
    if (!usingConnection || !activeConnectionId) {
      setChannelOptions([])
      setChannelsError(null)
      setChannelsLoading(false)
      return
    }

    refreshChannels()
  }, [activeConnectionId, refreshChannels, usingConnection])

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      {usingConnection ? (
        <>
          <NodeDropdownField
            options={channelOptions}
            value={slackParams.channel || ''}
            onChange={handleChannelChange}
            placeholder="Select Slack channel"
            loading={channelsLoading}
            disabled={!activeConnectionId}
            emptyMessage="No Slack channels available"
          />
          {validationErrors.channel && (
            <p className={errorClass}>{validationErrors.channel}</p>
          )}
          {channelsError && (
            <div className="flex items-center justify-between gap-2 text-xs text-red-500">
              <span className="flex-1">{channelsError}</span>
              <button
                type="button"
                className="whitespace-nowrap text-blue-600 hover:underline"
                onClick={refreshChannels}
              >
                Retry
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <NodeInputField
            placeholder="Channel (e.g. #general)"
            value={slackParams.channel || ''}
            onChange={handleChannelChange}
          />
          {validationErrors.channel && (
            <p className={errorClass}>{validationErrors.channel}</p>
          )}
        </>
      )}

      <NodeDropdownField
        options={connectionOptions}
        value={selectedConnectionValue}
        onChange={handleConnectionChange}
        placeholder="Select Slack connection"
        loading={connectionsLoading}
        emptyMessage="No Slack connections available"
      />
      {validationErrors.connection && (
        <p className={errorClass}>{validationErrors.connection}</p>
      )}
      {connectionsError && (
        <div className="flex items-center justify-between gap-2 text-xs text-red-500">
          <span className="flex-1">{connectionsError}</span>
          <button
            type="button"
            className="whitespace-nowrap text-blue-600 hover:underline"
            onClick={refreshConnections}
          >
            Retry
          </button>
        </div>
      )}
      {!connectionsLoading && !connectionsError && !hasOAuthConnections && (
        <p className="text-xs text-slate-500">
          Connect Slack in Settings → Integrations to reuse OAuth credentials{' '}
          instead of managing bot tokens manually.
        </p>
      )}
      {usingConnection && activeConnection?.accountEmail && (
        <p className="text-xs text-slate-500">
          Posting as {activeConnection.accountEmail} via Slack OAuth.
        </p>
      )}

      {!usingConnection && (
        <>
          <NodeSecretDropdown
            group="messaging"
            service="slack"
            value={slackParams.token || ''}
            onChange={handleTokenChange}
            placeholder="Select Slack token"
          />
          {validationErrors.token && (
            <p className={errorClass}>{validationErrors.token}</p>
          )}
        </>
      )}

      <NodeInputField
        placeholder="Message"
        value={slackParams.message || ''}
        onChange={handleMessageChange}
      />
      {validationErrors.message && (
        <p className={errorClass}>{validationErrors.message}</p>
      )}

      <p className="text-xs text-slate-500">
        Slack OAuth connections require the following scopes:{' '}
        <code>chat:write</code>, <code>channels:read</code>,{' '}
        <code>groups:read</code>, <code>users:read</code>, and{' '}
        <code>users:read.email</code>. Messages are sent as the connected Slack
        user and must target channels they can access.
      </p>
    </div>
  )
}

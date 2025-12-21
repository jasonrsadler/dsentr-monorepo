import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import deepEqual from 'fast-deep-equal'
import NodeDropdownField, {
  type NodeDropdownOptionGroup
} from '@/components/ui/InputFields/NodeDropdownField'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
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
  connectionScope?: string
  connectionId?: string
  accountEmail?: string
  connection?: SlackConnectionSelection
  identity?: 'workspace_bot' | 'personal_user'
  // NEW explicit backend parameters
  workspace_connection_id?: string
  personal_connection_id?: string
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
  connectionScope: '',
  connectionId: '',
  accountEmail: '',
  identity: undefined,
  workspace_connection_id: undefined,
  personal_connection_id: undefined
}

const sanitizeSlackPayload = (params: any): SlackActionValues => {
  // Legacy payloads may include postAsUser; intentionally ignored.
  const sanitized: SlackActionValues = {
    channel: typeof params.channel === 'string' ? params.channel : '',
    message: typeof params.message === 'string' ? params.message : '',
    connectionScope:
      typeof params.connectionScope === 'string' ? params.connectionScope : '',
    connectionId:
      typeof params.connectionId === 'string' ? params.connectionId : '',
    accountEmail:
      typeof params.accountEmail === 'string' ? params.accountEmail : '',
    identity:
      params.identity === 'workspace_bot' || params.identity === 'personal_user'
        ? params.identity
        : undefined,
    // NEW explicit backend parameters
    workspace_connection_id:
      typeof params.workspace_connection_id === 'string'
        ? params.workspace_connection_id
        : undefined,
    personal_connection_id:
      typeof params.personal_connection_id === 'string'
        ? params.personal_connection_id
        : undefined
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
  if (typeof slackRecord.connectionScope === 'string') {
    base.connectionScope = slackRecord.connectionScope
  }
  if (typeof slackRecord.connectionId === 'string') {
    base.connectionId = slackRecord.connectionId
  }
  if (typeof slackRecord.accountEmail === 'string') {
    base.accountEmail = slackRecord.accountEmail
  }
  if (
    slackRecord.identity === 'workspace_bot' ||
    slackRecord.identity === 'personal_user'
  ) {
    base.identity = slackRecord.identity
  }
  // NEW explicit backend parameters extraction
  if (typeof slackRecord.workspace_connection_id === 'string') {
    base.workspace_connection_id = slackRecord.workspace_connection_id
  }
  if (typeof slackRecord.personal_connection_id === 'string') {
    base.personal_connection_id = slackRecord.personal_connection_id
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

  const errors: Record<string, string> = {}

  // Validate identity first - it's the primary determinant of behavior
  if (
    params.identity !== 'workspace_bot' &&
    params.identity !== 'personal_user'
  ) {
    errors.identity =
      'Choose how this message should be sent. Select the workspace bot or post as yourself.'
    return {
      errors,
      activeConnection,
      hasValidationErrors: true
    }
  }

  // Only validate connection requirements after identity is valid
  if (params.identity === 'workspace_bot') {
    const workspaceConn =
      activeConnection?.connectionScope === 'workspace'
        ? activeConnection
        : null
    if (!workspaceConn?.connectionId) {
      errors.connection =
        'Select a workspace Slack connection to post as the workspace bot.'
    }
  } else if (params.identity === 'personal_user') {
    const personalConn =
      activeConnection?.connectionScope === 'user' ? activeConnection : null
    if (!personalConn?.connectionId) {
      errors.connection =
        'Authorize your personal Slack account to post as yourself.'
    }
  }

  if (!params.channel?.trim())
    errors.channel = 'Select a Slack channel to send this message.'
  if (!params.message?.trim()) errors.message = 'Enter a message to send.'

  return {
    errors,
    activeConnection,
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
  const { errors: validationErrors, activeConnection } = validation

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
  const [uiWorkspaceSelection, setUiWorkspaceSelection] = useState('')

  const pickProviderConnections = useCallback(
    (
      snapshot: GroupedConnectionsSnapshot | null,
      provider: OAuthProvider
    ): ProviderConnectionSet | null => {
      if (!snapshot) return null
      const personal = (snapshot.personal ?? [])
        .filter((p) => p.provider === provider)
        .map((p) => {
          const requiresReconnect = Boolean(p.requiresReconnect)
          const id = p.id ?? p.connectionId ?? null
          const connectionId = p.connectionId ?? p.id ?? undefined
          return {
            scope: 'personal' as const,
            id,
            connectionId,
            connected: Boolean(p.connected && id && !requiresReconnect),
            accountEmail: p.accountEmail,
            expiresAt: p.expiresAt,
            lastRefreshedAt: p.lastRefreshedAt,
            requiresReconnect,
            isShared: Boolean(p.isShared)
          }
        })
      const workspace = snapshot.workspace
        .filter((w) => w.provider === provider)
        .map((w) => ({ ...w }))
      if (personal.length === 0 && workspace.length === 0) {
        return null
      }
      return { personal, workspace }
    },
    []
  )

  const sanitizeConnections = useCallback(
    (connections: ProviderConnectionSet | null) => {
      if (!connections) return null
      const personal = (connections.personal ?? []).map((entry) => {
        const requiresReconnect = Boolean(entry.requiresReconnect)
        const id = entry.id ?? entry.connectionId ?? null
        return {
          ...entry,
          id,
          connectionId: entry.connectionId ?? entry.id ?? undefined,
          connected: Boolean(entry.connected && id && !requiresReconnect),
          requiresReconnect
        }
      })

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
          : 'Slack connections could not be loaded. Try again.'
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
        const personal = (connectionState.personal ?? []).find(
          (entry) => entry.connected && entry.id === id
        )
        if (personal) {
          const selection: SlackConnectionSelection = {
            connectionScope: 'user',
            connectionId: personal.id as string
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

  const workspaceConnectionOptions = useMemo(() => {
    if (!connectionState) return []
    return connectionState.workspace
      .filter((entry) => entry.connected && entry.id)
      .map((entry) => ({
        label: entry.accountEmail
          ? `${entry.workspaceName ?? 'Workspace connection'} – ${entry.accountEmail}`
          : (entry.workspaceName ?? 'Workspace connection'),
        value: connectionValueKey('workspace', entry.id!)
      }))
  }, [connectionState])

  const personalConnectionOptions = useMemo(() => {
    if (!connectionState) return []
    return (connectionState.personal ?? [])
      .filter((entry) => entry.connected && entry.id)
      .map((entry) => ({
        label: entry.accountEmail
          ? `Personal – ${entry.accountEmail}`
          : 'Personal Slack account',
        value: connectionValueKey('personal', entry.id as string)
      }))
  }, [connectionState])

  const hasOAuthConnections = useMemo(() => {
    if (!connectionState) return false
    const personalAvailable = (connectionState.personal ?? []).some(
      (entry) => entry.connected && Boolean(entry.id)
    )
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

  const storedConnectionValue = useMemo(() => {
    if (!activeConnection || !activeConnection.connectionId) return ''
    if (
      slackParams.identity === 'workspace_bot' &&
      activeConnection.connectionScope === 'workspace'
    ) {
      return connectionValueKey('workspace', activeConnection.connectionId)
    }
    if (
      slackParams.identity === 'personal_user' &&
      activeConnection.connectionScope === 'user'
    ) {
      return connectionValueKey('personal', activeConnection.connectionId)
    }
    return ''
  }, [activeConnection, slackParams.identity])

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

  const handleIdentityChange = useCallback(
    (identity: 'workspace_bot' | 'personal_user' | '') => {
      // Clear all connection state and validation errors when identity changes
      applySlackPatch({
        identity: identity || undefined,
        connectionScope: '',
        connectionId: '',
        accountEmail: '',
        connection: undefined,
        channel: '', // Clear channel to force re-selection with new identity
        workspace_connection_id: undefined,
        personal_connection_id: undefined
      })
      // Clear UI workspace selection state
      setUiWorkspaceSelection('')
    },
    [applySlackPatch]
  )

  const handleStoredConnectionChange = useCallback(
    (value: string) => {
      if (!value) {
        applySlackPatch({
          connectionScope: '',
          connectionId: '',
          accountEmail: '',
          connection: undefined,
          workspace_connection_id: undefined,
          personal_connection_id: undefined
        })
        return
      }

      const parsed = parseConnectionValue(value)
      if (!parsed) return

      const selection = findConnectionByValue(parsed.scope, parsed.id)
      if (!selection) {
        applySlackPatch({
          connectionScope: '',
          connectionId: '',
          accountEmail: '',
          connection: undefined,
          workspace_connection_id: undefined,
          personal_connection_id: undefined
        })
        return
      }

      // Inline explicit backend parameter wiring
      const explicitParams: Partial<SlackActionValues> = {}

      if (slackParams.identity === 'workspace_bot') {
        // workspace_bot + workspace selection → set workspace_connection_id
        if (
          selection.connectionScope === 'workspace' &&
          selection.connectionId
        ) {
          explicitParams.workspace_connection_id = selection.connectionId
        }
      } else if (slackParams.identity === 'personal_user') {
        // personal_user + personal selection → set personal_connection_id
        if (selection.connectionScope === 'user' && selection.connectionId) {
          explicitParams.personal_connection_id = selection.connectionId
        }
        // Do not compute workspace ID here for personal_user
      }

      applySlackPatch({
        connectionScope: selection.connectionScope,
        connectionId: selection.connectionId ?? '',
        accountEmail: selection.accountEmail ?? '',
        connection: selection,
        ...explicitParams // Add explicit backend parameters
      })
    },
    [applySlackPatch, findConnectionByValue, slackParams.identity]
  )

  const handleWorkspaceUiChange = useCallback(
    (value: string) => {
      setUiWorkspaceSelection(value)

      // Inline explicit backend parameter wiring for personal_user only
      if (slackParams.identity === 'personal_user') {
        const explicitParams: Partial<SlackActionValues> = {}

        // Parse UI workspace selection and set workspace_connection_id
        const parsed = value ? parseConnectionValue(value) : null
        if (parsed?.scope === 'workspace' && parsed.id) {
          explicitParams.workspace_connection_id = parsed.id
        }

        applySlackPatch(explicitParams)
      }
      // Do nothing for workspace_bot
    },
    [applySlackPatch, slackParams.identity]
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

  const workspaceConnectionIdForChannels = useMemo(() => {
    if (slackParams.identity === 'workspace_bot') {
      return activeConnection?.connectionScope === 'workspace'
        ? activeConnection.connectionId
        : ''
    }
    if (slackParams.identity === 'personal_user') {
      const parsed = uiWorkspaceSelection
        ? parseConnectionValue(uiWorkspaceSelection)
        : null
      return parsed?.scope === 'workspace' ? parsed.id : ''
    }
    return ''
  }, [slackParams.identity, activeConnection, uiWorkspaceSelection])

  // NEW explicit personal connection ID for channels
  const personalConnectionIdForChannels = useMemo(() => {
    if (slackParams.identity === 'personal_user') {
      return activeConnection?.connectionScope === 'user'
        ? activeConnection.connectionId
        : undefined
    }
    return undefined
  }, [slackParams.identity, activeConnection])

  const refreshChannels = useCallback(async () => {
    const workspaceConnectionId = workspaceConnectionIdForChannels
    const personalConnectionId = personalConnectionIdForChannels

    if (!workspaceConnectionId) {
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
        workspaceConnectionId,
        personalConnectionId // Now passes explicit personal connection ID for personal_user
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
          : 'Slack channels could not be loaded. Try again.'
      )
    } finally {
      if (!isStale()) {
        setChannelsLoading(false)
      }
    }
  }, [
    workspaceConnectionIdForChannels,
    personalConnectionIdForChannels, // Add to dependencies
    applySlackPatch,
    buildChannelOptions,
    slackParams.channel
  ])

  useEffect(() => {
    const workspaceConnectionId = workspaceConnectionIdForChannels
    if (!workspaceConnectionId) {
      setChannelOptions([])
      setChannelsError(null)
      setChannelsLoading(false)
      return
    }

    refreshChannels()
  }, [
    workspaceConnectionIdForChannels,
    personalConnectionIdForChannels,
    refreshChannels
  ])

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      {/* Identity Selector - First field */}
      <NodeDropdownField
        options={[
          {
            label: 'Identity',
            options: [
              {
                label: 'Post as workspace bot',
                value: 'workspace_bot'
              },
              {
                label: 'Post as you',
                value: 'personal_user'
              }
            ]
          }
        ]}
        value={slackParams.identity || ''}
        onChange={(value) =>
          handleIdentityChange(value as 'workspace_bot' | 'personal_user' | '')
        }
        placeholder="Select how to send Slack messages"
        disabled={!effectiveCanEdit}
      />
      {validationErrors.identity && (
        <p className={errorClass}>{validationErrors.identity}</p>
      )}

      <NodeDropdownField
        options={channelOptions}
        value={slackParams.channel || ''}
        onChange={handleChannelChange}
        placeholder="Select Slack channel"
        loading={channelsLoading}
        disabled={!workspaceConnectionIdForChannels}
        emptyMessage="No channels are available for selected identity"
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

      {slackParams.identity && (
        <>
          {/* Workspace Connection - Required for both identities */}
          <NodeDropdownField
            options={workspaceConnectionOptions}
            value={
              slackParams.identity === 'workspace_bot'
                ? storedConnectionValue
                : uiWorkspaceSelection
            }
            onChange={
              slackParams.identity === 'workspace_bot'
                ? handleStoredConnectionChange
                : handleWorkspaceUiChange
            }
            placeholder="Select workspace Slack connection"
            loading={connectionsLoading}
            emptyMessage="No workspace Slack connections are available"
            disabled={!slackParams.identity}
          />

          {/* Personal Connection - Required only for personal_user identity */}
          {slackParams.identity === 'personal_user' && (
            <NodeDropdownField
              options={personalConnectionOptions}
              value={storedConnectionValue}
              onChange={handleStoredConnectionChange}
              placeholder="Select personal Slack connection"
              loading={connectionsLoading}
              emptyMessage="No personal Slack authorizations are available"
              disabled={!slackParams.identity}
            />
          )}

          {/* Validation errors */}
          {validationErrors.connection && (
            <p className={errorClass}>{validationErrors.connection}</p>
          )}
          {slackParams.identity === 'personal_user' &&
            validationErrors.connection && (
              <p className={errorClass}>{validationErrors.connection}</p>
            )}
        </>
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
          Each Dsentr workspace has a single Slack workspace installation. "Post
          as workspace bot" sends messages using that installation. "Post as
          you" requires personal Slack authorization. Channel lists reflect what
          the selected identity can access.
        </p>
      )}

      <NodeInputField
        placeholder="Message"
        value={slackParams.message || ''}
        onChange={handleMessageChange}
      />
      {validationErrors.message && (
        <p className={errorClass}>{validationErrors.message}</p>
      )}
    </div>
  )
}

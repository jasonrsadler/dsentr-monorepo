import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import deepEqual from 'fast-deep-equal'
import NodeDropdownField, {
  type NodeDropdownOptionGroup
} from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import {
  fetchConnections,
  getCachedConnections,
  subscribeToConnectionUpdates,
  type ConnectionScope,
  type ProviderConnectionSet
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'

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
  args: SlackActionValues
  initialDirty?: boolean
  onChange?: (
    args: SlackActionValues,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
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

const normalizeParams = (incoming?: SlackActionValues): SlackActionValues => {
  const next: SlackActionValues = {
    channel: typeof incoming?.channel === 'string' ? incoming.channel : '',
    message: typeof incoming?.message === 'string' ? incoming.message : '',
    token: typeof incoming?.token === 'string' ? incoming.token : '',
    connectionScope: '',
    connectionId: '',
    accountEmail: ''
  }

  const connectionSelection =
    buildSelectionFromValue((incoming as any)?.connection) ??
    buildSelectionFromParts(
      incoming?.connectionScope,
      incoming?.connectionId,
      incoming?.accountEmail
    )

  if (connectionSelection) {
    next.connectionScope = connectionSelection.connectionScope
    if (connectionSelection.connectionId) {
      next.connectionId = connectionSelection.connectionId
    }
    if (connectionSelection.accountEmail) {
      next.accountEmail = connectionSelection.accountEmail
    }
    next.connection = cloneSelection(connectionSelection)
  }

  return next
}

const applyConnectionSelection = (
  current: SlackActionValues,
  selection: SlackConnectionSelection | null
): SlackActionValues => {
  const next: SlackActionValues = {
    ...current
  }

  if (!selection) {
    next.connectionScope = ''
    next.connectionId = ''
    next.accountEmail = ''
    if ('connection' in next) {
      delete (next as Record<string, unknown>).connection
    }
    return next
  }

  next.connectionScope = selection.connectionScope
  next.connectionId = selection.connectionId ?? ''
  next.accountEmail = selection.accountEmail ?? ''
  next.connection = cloneSelection(selection)
  next.token = ''
  return next
}

const cloneForEmit = (value: SlackActionValues): SlackActionValues => {
  const snapshot: SlackActionValues = { ...value }
  if (value.connection) {
    snapshot.connection = cloneSelection(value.connection)
  } else if ('connection' in snapshot) {
    delete (snapshot as Record<string, unknown>).connection
  }
  return snapshot
}

export default function SlackAction({
  args,
  initialDirty = false,
  onChange
}: SlackActionProps) {
  const [params, setParams] = useState<SlackActionValues>(() =>
    normalizeParams(args)
  )
  const [dirty, setDirty] = useState(initialDirty)
  const lastNormalizedArgsRef = useRef<SlackActionValues>(params)

  const argsConnection = (args as { connection?: unknown }).connection

  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const next = normalizeParams(args)
    if (!deepEqual(next, lastNormalizedArgsRef.current)) {
      lastNormalizedArgsRef.current = next
      setParams(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args?.channel,
    args?.message,
    args?.token,
    args?.connectionScope,
    args?.connectionId,
    args?.accountEmail,
    argsConnection
  ])

  useEffect(() => {
    setDirty(initialDirty)
  }, [initialDirty])

  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null

  const [connectionState, setConnectionState] =
    useState<ProviderConnectionSet | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const refreshRequestIdRef = useRef(0)

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
      const map = await fetchConnections({ workspaceId })
      if (isStale()) {
        return
      }
      const slackConnections = sanitizeConnections(map.slack ?? null)
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
  }, [sanitizeConnections, workspaceId])

  useEffect(() => {
    const cached = getCachedConnections(workspaceId)?.slack ?? null
    setConnectionState(sanitizeConnections(cached))

    const unsubscribe = subscribeToConnectionUpdates(
      (snapshot) => {
        if (!mountedRef.current) return
        const slackConnections = snapshot?.slack ?? null
        setConnectionState(sanitizeConnections(slackConnections))
      },
      { workspaceId }
    )

    refreshConnections()

    return () => {
      unsubscribe()
    }
  }, [refreshConnections, sanitizeConnections, workspaceId])

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

  const activeConnection = useMemo(() => {
    const fromParams = buildSelectionFromValue(params.connection)
    if (fromParams) return fromParams
    return buildSelectionFromParts(
      params.connectionScope,
      params.connectionId,
      params.accountEmail
    )
  }, [
    params.accountEmail,
    params.connection,
    params.connectionId,
    params.connectionScope
  ])

  const usingConnection = Boolean(activeConnection)

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

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!params.channel?.trim()) errors.channel = 'Channel is required'
    if (!params.message?.trim()) errors.message = 'Message cannot be empty'
    if (!usingConnection && !params.token?.trim()) {
      errors.token = 'Slack token is required'
    }
    if (usingConnection && !activeConnection?.connectionId) {
      errors.connection = 'Slack connection is required'
    }
    return errors
  }, [
    activeConnection,
    params.channel,
    params.message,
    params.token,
    usingConnection
  ])

  const lastEmittedRef = useRef<{
    payload: SlackActionValues
    hasErrors: boolean
    dirty: boolean
  } | null>(null)

  useEffect(() => {
    if (!onChange) return
    const hasErrors = Object.keys(validationErrors).length > 0
    const snapshot = cloneForEmit(params)
    const last = lastEmittedRef.current
    if (
      last &&
      last.dirty === dirty &&
      last.hasErrors === hasErrors &&
      deepEqual(last.payload, snapshot)
    ) {
      return
    }

    lastEmittedRef.current = {
      payload: cloneForEmit(snapshot),
      hasErrors,
      dirty
    }
    onChange(snapshot, hasErrors, dirty)
  }, [dirty, onChange, params, validationErrors])

  const updateField = (key: keyof SlackActionValues, value: string) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const handleConnectionChange = (value: string) => {
    setDirty(true)
    if (value === 'manual') {
      setParams((prev) => applyConnectionSelection(prev, null))
      return
    }

    const parsed = parseConnectionValue(value)
    if (!parsed) return

    const selection = findConnectionByValue(parsed.scope, parsed.id)
    if (!selection) {
      setParams((prev) => applyConnectionSelection(prev, null))
      return
    }

    setParams((prev) => applyConnectionSelection(prev, selection))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="Channel (e.g. #general)"
        value={params.channel || ''}
        onChange={(val) => updateField('channel', val)}
      />
      {validationErrors.channel && (
        <p className={errorClass}>{validationErrors.channel}</p>
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

      <NodeSecretDropdown
        group="messaging"
        service="slack"
        value={params.token || ''}
        onChange={(val) => updateField('token', val)}
        placeholder="Select Slack token"
        disabled={usingConnection}
      />
      {!usingConnection && validationErrors.token && (
        <p className={errorClass}>{validationErrors.token}</p>
      )}
      {usingConnection && (
        <p className="text-xs text-slate-500">
          Manual tokens are disabled while an OAuth connection is selected.
        </p>
      )}

      <NodeInputField
        placeholder="Message"
        value={params.message || ''}
        onChange={(val) => updateField('message', val)}
      />
      {validationErrors.message && (
        <p className={errorClass}>{validationErrors.message}</p>
      )}

      <p className="text-xs text-slate-500">
        Slack OAuth connections require the following scopes:{' '}
        <code>chat:write</code>, <code>channels:read</code>,{' '}
        <code>groups:read</code>, <code>users:read</code>,{' '}
        <code>users:read.email</code>, and <code>offline_access</code>. Messages
        are sent as the connected Slack user and must target channels they can
        access.
      </p>
    </div>
  )
}

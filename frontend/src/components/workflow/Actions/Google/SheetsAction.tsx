import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import NodeDropdownField, {
  type NodeDropdownOptionGroup
} from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import {
  fetchConnections,
  getCachedConnections,
  subscribeToConnectionUpdates,
  type ConnectionScope,
  type ProviderConnectionSet
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import {
  type SheetsActionParams,
  useSheetsActionParams
} from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

interface SheetsActionProps {
  nodeId: string
  canEdit?: boolean
}

const MAX_SHEETS_COLUMNS = 18278
const COLUMN_KEY_REGEX = /^[A-Za-z]+$/

const columnKeyToIndex = (key: string) => {
  let index = 0
  for (const char of key.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index
}

const validateColumnMappings = (
  columns: { key: string; value: string }[]
): string | undefined => {
  if (!columns || columns.length === 0)
    return 'At least one column mapping is required'

  const seen = new Set<number>()

  for (let i = 0; i < columns.length; i += 1) {
    const rawKey = columns[i]?.key?.trim()
    if (!rawKey) return `Column name is required for mapping ${i + 1}`
    if (rawKey.includes('{') || rawKey.includes('}'))
      return 'Column names cannot contain template expressions'
    if (!COLUMN_KEY_REGEX.test(rawKey))
      return 'Column names must only include letters (e.g. A, B, AA)'

    const columnIndex = columnKeyToIndex(rawKey)
    if (columnIndex === 0 || columnIndex > MAX_SHEETS_COLUMNS)
      return `Column ${rawKey.toUpperCase()} exceeds the Google Sheets column limit`

    if (seen.has(columnIndex))
      return `Duplicate column ${rawKey.toUpperCase()} detected`

    seen.add(columnIndex)
  }

  return undefined
}

const connectionValueKey = (scope: ConnectionScope, id: string) =>
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

export default function SheetsAction({
  nodeId,
  canEdit = true
}: SheetsActionProps) {
  const params = useSheetsActionParams(nodeId)
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit
  const validationRef = useRef<boolean | null>(null)

  const applySheetsParamsPatch = useCallback(
    (patch: Partial<Omit<SheetsActionParams, 'dirty'>>) => {
      if (!effectiveCanEdit) return

      const storeState = useWorkflowStore.getState()
      const nodes = Array.isArray(storeState.nodes) ? storeState.nodes : []
      const node = nodes.find((candidate) => candidate.id === nodeId)

      let currentParams: Partial<SheetsActionParams> = {}
      if (node && node.data && typeof node.data === 'object') {
        const dataRecord = node.data as Record<string, unknown>
        const rawParams = dataRecord.params
        if (rawParams && typeof rawParams === 'object') {
          currentParams = rawParams as SheetsActionParams
        }
      }

      if (!currentParams || Object.keys(currentParams).length === 0) {
        currentParams = params ?? {}
      }

      const { dirty: _dirty, ...rest } = currentParams

      updateNodeData(nodeId, {
        params: { ...rest, ...patch },
        dirty: true
      })
    },
    [effectiveCanEdit, nodeId, params, updateNodeData]
  )

  const {
    spreadsheetId,
    worksheet,
    columns = [],
    accountEmail,
    oauthConnectionScope,
    oauthConnectionId
  } = params

  const [connectionState, setConnectionState] =
    useState<ProviderConnectionSet | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(true)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)

  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null

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

  useEffect(() => {
    let active = true

    const cached = getCachedConnections(workspaceId)
    if (cached?.google) {
      setConnectionState(sanitizeConnections(cached.google))
      setConnectionsError(null)
      setConnectionsLoading(false)
    } else {
      setConnectionState(null)
    }

    const unsubscribe = subscribeToConnectionUpdates(
      (snapshot) => {
        if (!active) return
        const googleConnections = snapshot?.google ?? null
        if (!googleConnections) {
          setConnectionState(null)
          setConnectionsLoading(false)
          return
        }
        setConnectionState(sanitizeConnections(googleConnections))
        setConnectionsError(null)
        setConnectionsLoading(false)
      },
      { workspaceId }
    )

    if (!cached) {
      setConnectionsLoading(true)
      setConnectionsError(null)
      fetchConnections({ workspaceId })
        .then((connections) => {
          if (!active) return
          setConnectionState(sanitizeConnections(connections.google ?? null))
          setConnectionsError(null)
        })
        .catch((error) => {
          if (!active) return
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to load Google connections'
          setConnectionsError(message)
          setConnectionState(null)
        })
        .finally(() => {
          if (!active) return
          setConnectionsLoading(false)
        })
    }

    return () => {
      active = false
      unsubscribe()
    }
  }, [sanitizeConnections, workspaceId])

  const findConnectionById = useCallback(
    (scope?: ConnectionScope | null, id?: string | null) => {
      if (!connectionState || !scope || !id) return null
      if (scope === 'personal') {
        const personal = connectionState.personal
        if (!personal.connected || !personal.id) return null
        return personal.id === id ? personal : null
      }

      return connectionState.workspace.find((entry) => entry.id === id) ?? null
    },
    [connectionState]
  )

  const findConnectionByEmail = useCallback(
    (email?: string | null) => {
      if (!connectionState) return null
      const normalized = email?.trim().toLowerCase()
      if (!normalized) return null

      const personal = connectionState.personal
      if (
        personal.connected &&
        personal.accountEmail &&
        personal.accountEmail.trim().toLowerCase() === normalized
      ) {
        return personal
      }

      return (
        connectionState.workspace.find(
          (entry) =>
            entry.accountEmail &&
            entry.accountEmail.trim().toLowerCase() === normalized
        ) ?? null
      )
    },
    [connectionState]
  )

  useEffect(() => {
    if (!connectionState) return

    const scope =
      oauthConnectionScope === 'personal' ||
      oauthConnectionScope === 'workspace'
        ? oauthConnectionScope
        : undefined
    const id = oauthConnectionId?.trim() || undefined
    const email = accountEmail?.trim() || undefined

    let selected = findConnectionById(scope, id)
    if (!selected && email) {
      selected = findConnectionByEmail(email)
    }

    const wasWorkspaceSelection = scope === 'workspace'

    if (!selected && wasWorkspaceSelection) {
      if (oauthConnectionScope || oauthConnectionId || accountEmail) {
        applySheetsParamsPatch({
          oauthConnectionScope: '',
          oauthConnectionId: '',
          accountEmail: ''
        })
      }
      return
    }

    if (!selected) {
      const personal = connectionState.personal
      if (personal.connected && personal.id) {
        selected = personal
      }
    }

    if (!selected && !wasWorkspaceSelection) {
      if (connectionState.workspace.length === 1) {
        selected = connectionState.workspace[0]
      }
    }

    if (!selected) {
      if (oauthConnectionScope || oauthConnectionId || accountEmail) {
        applySheetsParamsPatch({
          oauthConnectionScope: '',
          oauthConnectionId: '',
          accountEmail: ''
        })
      }
      return
    }

    const nextScope = selected.scope
    const nextId = selected.id ?? ''
    const nextEmail = selected.accountEmail ?? ''

    const updates: Partial<SheetsActionParams> = {}
    if (oauthConnectionScope !== nextScope) {
      updates.oauthConnectionScope = nextScope
    }
    if ((oauthConnectionId ?? '') !== nextId) {
      updates.oauthConnectionId = nextId
    }
    if ((accountEmail ?? '') !== nextEmail) {
      updates.accountEmail = nextEmail
    }

    if (Object.keys(updates).length > 0) {
      applySheetsParamsPatch(updates)
    }
  }, [
    accountEmail,
    connectionState,
    applySheetsParamsPatch,
    findConnectionByEmail,
    findConnectionById,
    oauthConnectionId,
    oauthConnectionScope
  ])

  const connectionChoices = useMemo(() => {
    if (!connectionState)
      return [] as (
        | ProviderConnectionSet['personal']
        | ProviderConnectionSet['workspace'][number]
      )[]

    const entries: (
      | ProviderConnectionSet['personal']
      | ProviderConnectionSet['workspace'][number]
    )[] = []
    const personal = connectionState.personal
    if (personal.connected && personal.id) {
      entries.push(personal)
    }
    for (const entry of connectionState.workspace) {
      if (entry.id) {
        entries.push(entry)
      }
    }
    return entries
  }, [connectionState])

  const connectionOptionGroups = useMemo<NodeDropdownOptionGroup[]>(() => {
    if (!connectionState) return []
    const groups: NodeDropdownOptionGroup[] = []
    const personal = connectionState.personal
    if (personal.connected && personal.id) {
      groups.push({
        label: 'Your connections',
        options: [
          {
            value: connectionValueKey('personal', personal.id),
            label: personal.accountEmail?.trim() || 'Personal Google account'
          }
        ]
      })
    }

    const workspaceOptions = connectionState.workspace
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
          value: connectionValueKey('workspace', id),
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
  }, [connectionState])

  const selectedConnectionValue = useMemo(() => {
    const scope = oauthConnectionScope
    const id = oauthConnectionId
    if (scope !== 'personal' && scope !== 'workspace') return ''
    if (!id) return ''
    return connectionValueKey(scope, id)
  }, [oauthConnectionId, oauthConnectionScope])

  const selectedConnection = useMemo(() => {
    const scope =
      oauthConnectionScope === 'personal' ||
      oauthConnectionScope === 'workspace'
        ? (oauthConnectionScope as ConnectionScope)
        : undefined
    const id = oauthConnectionId?.trim() || undefined
    return findConnectionById(scope, id)
  }, [findConnectionById, oauthConnectionId, oauthConnectionScope])

  const validationErrors = useMemo(() => {
    const errors: {
      spreadsheetId?: string
      worksheet?: string
      columns?: string
      accountEmail?: string
    } = {}

    if (!spreadsheetId?.trim()) {
      errors.spreadsheetId = 'Spreadsheet ID is required'
    }
    if (!worksheet?.trim()) {
      errors.worksheet = 'Worksheet name is required'
    }

    if (!columns || columns.length === 0) {
      errors.columns = 'At least one column mapping is required'
    } else {
      const columnError = validateColumnMappings(columns)
      if (columnError) errors.columns = columnError
    }

    if (connectionsError) {
      errors.accountEmail = connectionsError
    } else if (!connectionsLoading) {
      if (connectionChoices.length === 0) {
        errors.accountEmail =
          'Connect a Google account in Settings → Integrations'
      } else {
        const scope =
          oauthConnectionScope === 'personal' ||
          oauthConnectionScope === 'workspace'
            ? oauthConnectionScope
            : null
        const id = oauthConnectionId?.toString().trim() || ''

        if (!scope || !id) {
          errors.accountEmail = 'Select a connected Google account'
        } else if (
          !connectionChoices.some(
            (choice) => choice.scope === scope && (choice.id ?? '') === id
          )
        ) {
          errors.accountEmail =
            'Selected Google connection is no longer available. Refresh your integrations.'
        }
      }
    }

    return errors
  }, [
    connectionChoices,
    connectionsError,
    connectionsLoading,
    columns,
    oauthConnectionId,
    oauthConnectionScope,
    spreadsheetId,
    worksheet
  ])

  const hasValidationErrors = useMemo(
    () => Object.keys(validationErrors).length > 0,
    [validationErrors]
  )

  useEffect(() => {
    if (validationRef.current === hasValidationErrors) return
    validationRef.current = hasValidationErrors
    updateNodeData(nodeId, { hasValidationErrors })
  }, [hasValidationErrors, nodeId, updateNodeData])

  const handleConnectionChange = useCallback(
    (value: string) => {
      const parsed = parseConnectionValue(value)
      if (!parsed) {
        applySheetsParamsPatch({
          oauthConnectionScope: '',
          oauthConnectionId: '',
          accountEmail: ''
        })
        return
      }

      const match = findConnectionById(parsed.scope, parsed.id)
      applySheetsParamsPatch({
        oauthConnectionScope: parsed.scope,
        oauthConnectionId: parsed.id,
        accountEmail: match?.accountEmail ?? ''
      })
    },
    [applySheetsParamsPatch, findConnectionById]
  )

  const handleSpreadsheetChange = useCallback(
    (value: string) => {
      applySheetsParamsPatch({ spreadsheetId: value })
    },
    [applySheetsParamsPatch]
  )

  const handleWorksheetChange = useCallback(
    (value: string) => {
      applySheetsParamsPatch({ worksheet: value })
    },
    [applySheetsParamsPatch]
  )

  const handleColumnsChange = useCallback(
    (updatedVars: { key: string; value: string }[]) => {
      applySheetsParamsPatch({ columns: updatedVars })
    },
    [applySheetsParamsPatch]
  )

  const usingWorkspaceCredential = selectedConnection?.scope === 'workspace'
  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeDropdownField
        options={connectionOptionGroups}
        value={selectedConnectionValue}
        onChange={handleConnectionChange}
        placeholder={
          connectionsLoading
            ? 'Loading Google connections…'
            : connectionOptionGroups.length > 0
              ? 'Select Google connection'
              : 'No Google connections available'
        }
        disabled={
          !effectiveCanEdit ||
          connectionsLoading ||
          connectionOptionGroups.length === 0
        }
        loading={connectionsLoading}
        emptyMessage={connectionsError || 'No Google connections available'}
      />
      {connectionsError && (
        <p className="text-xs text-red-500">{connectionsError}</p>
      )}
      {!connectionsError && validationErrors.accountEmail && (
        <p className={errorClass}>{validationErrors.accountEmail}</p>
      )}
      {usingWorkspaceCredential &&
        selectedConnection?.scope === 'workspace' && (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700 shadow-sm dark:border-blue-400/60 dark:bg-blue-500/10 dark:text-blue-200">
            This action will run using the workspace credential
            {selectedConnection.workspaceName
              ? ` "${selectedConnection.workspaceName}"`
              : ''}
            . Workspace admins manage refresh tokens in Settings → Integrations.
          </p>
        )}

      <NodeInputField
        placeholder="Spreadsheet ID"
        value={spreadsheetId || ''}
        onChange={handleSpreadsheetChange}
      />
      {validationErrors.spreadsheetId && (
        <p className={errorClass}>{validationErrors.spreadsheetId}</p>
      )}

      <NodeInputField
        placeholder="Worksheet Name"
        value={worksheet || ''}
        onChange={handleWorksheetChange}
      />
      {validationErrors.worksheet && (
        <p className={errorClass}>{validationErrors.worksheet}</p>
      )}

      <KeyValuePair
        title="Column Mappings"
        variables={columns || []}
        placeholderKey="Column"
        placeholderValue="Value"
        onChange={(updatedVars) => handleColumnsChange(updatedVars)}
      />
      {validationErrors.columns && (
        <p className={errorClass}>{validationErrors.columns}</p>
      )}
    </div>
  )
}

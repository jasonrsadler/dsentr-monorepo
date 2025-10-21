import NodeDropdownField, {
  type NodeDropdownOptionGroup
} from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  fetchConnections,
  getCachedConnections,
  subscribeToConnectionUpdates,
  type ConnectionScope,
  type ProviderConnectionSet
} from '@/lib/oauthApi'

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

interface SheetsActionProps {
  spreadsheetId: string
  worksheet: string
  columns: { key: string; value: string }[]
  accountEmail?: string
  oauthConnectionScope?: ConnectionScope
  oauthConnectionId?: string
  dirty: boolean
  setParams: (params: Partial<SheetsActionProps>) => void
  setDirty: (dirty: boolean) => void
}

interface SheetsActionErrorProps extends Partial<SheetsActionProps> {
  spreadsheetIdError?: string
  worksheetError?: string
  columnsError?: string
  accountEmailError?: string
}

export default function SheetsAction({
  args,
  onChange
}: {
  args: SheetsActionProps
  onChange?: (
    args: Partial<SheetsActionProps>,
    hasErrors: boolean,
    dirty: boolean
  ) => void
}) {
  const [_, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<SheetsActionProps>>({
    ...args,
    spreadsheetId: args.spreadsheetId || '',
    worksheet: args.worksheet || '',
    columns: args.columns || [],
    accountEmail: args.accountEmail || '',
    oauthConnectionScope: args.oauthConnectionScope || '',
    oauthConnectionId: args.oauthConnectionId || ''
  })
  const [connectionState, setConnectionState] =
    useState<ProviderConnectionSet | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(true)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)

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
    let active = true

    const cached = getCachedConnections()
    if (cached?.google) {
      setConnectionState(sanitizeConnections(cached.google))
      setConnectionsError(null)
      setConnectionsLoading(false)
    }

    const unsubscribe = subscribeToConnectionUpdates((snapshot) => {
      if (!active) return
      const googleConnections = snapshot?.google ?? null
      setConnectionState(sanitizeConnections(googleConnections))
      setConnectionsError(null)
      setConnectionsLoading(false)
    })

    if (!cached) {
      setConnectionsLoading(true)
      setConnectionsError(null)
      fetchConnections()
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
  }, [sanitizeConnections])

  useEffect(() => {
    if (!connectionState) return
    setParams((prev) => {
      if (!prev) return prev

      const rawScope = prev.oauthConnectionScope
      const scope =
        rawScope === 'personal' || rawScope === 'workspace'
          ? (rawScope as ConnectionScope)
          : undefined
      const id = prev.oauthConnectionId?.trim() || undefined
      const email = prev.accountEmail?.trim() || undefined

      let selected = findConnectionById(scope, id)
      if (!selected && email) {
        selected = findConnectionByEmail(email)
      }
      const wasWorkspaceSelection = scope === 'workspace'
      if (!selected && wasWorkspaceSelection) {
        if (
          prev.oauthConnectionScope ||
          prev.oauthConnectionId ||
          prev.accountEmail
        ) {
          return {
            ...prev,
            oauthConnectionScope: '',
            oauthConnectionId: '',
            accountEmail: ''
          }
        }
        return prev
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
        if (
          prev.oauthConnectionScope ||
          prev.oauthConnectionId ||
          prev.accountEmail
        ) {
          return {
            ...prev,
            oauthConnectionScope: '',
            oauthConnectionId: '',
            accountEmail: ''
          }
        }
        return prev
      }

      const nextScope = selected.scope
      const nextId = selected.id ?? ''
      const nextEmail = selected.accountEmail ?? ''

      if (
        prev.oauthConnectionScope === nextScope &&
        prev.oauthConnectionId === nextId &&
        (prev.accountEmail ?? '') === nextEmail
      ) {
        return prev
      }

      return {
        ...prev,
        oauthConnectionScope: nextScope,
        oauthConnectionId: nextId,
        accountEmail: nextEmail
      }
    })
  }, [connectionState, findConnectionByEmail, findConnectionById, setParams])

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

  const hasErrors = (updatedParams: Partial<SheetsActionProps>) => {
    const errors: Partial<SheetsActionErrorProps> = {}
    if (!updatedParams.spreadsheetId?.trim())
      errors.spreadsheetIdError = 'Spreadsheet ID is required'
    if (!updatedParams.worksheet?.trim())
      errors.worksheetError = 'Worksheet name is required'
    if (!updatedParams.columns || updatedParams.columns.length === 0) {
      errors.columnsError = 'At least one column mapping is required'
    } else {
      const columnError = validateColumnMappings(updatedParams.columns)
      if (columnError) errors.columnsError = columnError
    }
    const selectedScope =
      updatedParams.oauthConnectionScope ?? params.oauthConnectionScope ?? ''
    const selectedId =
      updatedParams.oauthConnectionId ?? params.oauthConnectionId ?? ''

    if (connectionsError) {
      errors.accountEmailError = connectionsError
    } else if (!connectionsLoading) {
      if (connectionChoices.length === 0) {
        errors.accountEmailError =
          'Connect a Google account in Settings → Integrations'
      } else {
        const normalizedScope =
          selectedScope === 'personal' || selectedScope === 'workspace'
            ? selectedScope
            : null
        const normalizedId = (selectedId ?? '').toString().trim()

        if (!normalizedScope || !normalizedId) {
          errors.accountEmailError = 'Select a connected Google account'
        } else if (
          !connectionChoices.some(
            (choice) =>
              choice.scope === normalizedScope && choice.id === normalizedId
          )
        ) {
          errors.accountEmailError =
            'Selected Google connection is no longer available. Refresh your integrations.'
        }
      }
    }
    return errors
  }

  const validationErrors = useMemo(
    () => hasErrors(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, connectionChoices, connectionsError, connectionsLoading]
  )

  useEffect(() => {
    onChange?.(params, Object.keys(validationErrors).length > 0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, validationErrors])

  const updateField = (key: keyof SheetsActionProps, value: any) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

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
    const scope = params.oauthConnectionScope
    const id = params.oauthConnectionId
    if (scope !== 'personal' && scope !== 'workspace') return ''
    if (!id) return ''
    return connectionValueKey(scope, id)
  }, [params.oauthConnectionScope, params.oauthConnectionId])

  const selectedConnection = useMemo(() => {
    const scope =
      params.oauthConnectionScope === 'personal' ||
      params.oauthConnectionScope === 'workspace'
        ? (params.oauthConnectionScope as ConnectionScope)
        : undefined
    const id = params.oauthConnectionId?.trim() || undefined
    return findConnectionById(scope, id)
  }, [
    findConnectionById,
    params.oauthConnectionId,
    params.oauthConnectionScope
  ])

  const handleConnectionChange = useCallback(
    (value: string) => {
      setDirty(true)
      const parsed = parseConnectionValue(value)
      if (!parsed) {
        setParams((prev) => ({
          ...prev,
          oauthConnectionScope: '',
          oauthConnectionId: '',
          accountEmail: ''
        }))
        return
      }
      const match = findConnectionById(parsed.scope, parsed.id)
      setParams((prev) => ({
        ...prev,
        oauthConnectionScope: parsed.scope,
        oauthConnectionId: parsed.id,
        accountEmail: match?.accountEmail ?? ''
      }))
    },
    [findConnectionById, setParams]
  )

  const usingWorkspaceCredential = selectedConnection?.scope === 'workspace'

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
        disabled={connectionsLoading || connectionOptionGroups.length === 0}
        loading={connectionsLoading}
        emptyMessage={connectionsError || 'No Google connections available'}
      />
      {connectionsError && (
        <p className="text-xs text-red-500">{connectionsError}</p>
      )}
      {!connectionsError && validationErrors.accountEmailError && (
        <p className={errorClass}>{validationErrors.accountEmailError}</p>
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
        value={params.spreadsheetId || ''}
        onChange={(val) => updateField('spreadsheetId', val)}
      />
      {validationErrors.spreadsheetIdError && (
        <p className={errorClass}>{validationErrors.spreadsheetIdError}</p>
      )}

      <NodeInputField
        placeholder="Worksheet Name"
        value={params.worksheet || ''}
        onChange={(val) => updateField('worksheet', val)}
      />
      {validationErrors.worksheetError && (
        <p className={errorClass}>{validationErrors.worksheetError}</p>
      )}

      <KeyValuePair
        title="Column Mappings"
        variables={params.columns || []}
        placeholderKey="Column"
        placeholderValue="Value"
        onChange={(updatedVars, nodeHasErrors, childDirty) => {
          setParams((prev) => ({ ...prev, columns: updatedVars }))
          setDirty((prev) => prev || childDirty)
          onChange?.(
            { ...params, columns: updatedVars },
            nodeHasErrors,
            childDirty
          )
        }}
      />
      {validationErrors.columnsError && (
        <p className={errorClass}>{validationErrors.columnsError}</p>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import NodeDropdownField, {
  type NodeDropdownOptionGroup
} from '@/components/ui/InputFields/NodeDropdownField'
import { fetchSpreadsheetSheets } from '@/lib/googleSheetsApi'
import { fetchGoogleAccessToken } from '@/lib/googleSheetsApi'
import KeyValuePair from '@/components/ui/ReactFlow/KeyValuePair'
import {
  fetchConnections,
  getCachedConnections,
  subscribeToConnectionUpdates,
  type ConnectionScope,
  type ProviderConnectionSet,
  type GroupedConnectionsSnapshot,
  type OAuthProvider
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import {
  type SheetsActionParams,
  useSheetsActionParams
} from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'
import {
  DrivePicker,
  DrivePickerDocsView
} from '@googleworkspace/drive-picker-react'
import { Plus } from 'lucide-react'

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
    worksheetId,
    columns = [],
    accountEmail,
    oauthConnectionScope,
    oauthConnectionId
  } = params
  const rawParams = params as Record<string, unknown>
  const rawConnectionScope =
    typeof rawParams.connectionScope === 'string'
      ? rawParams.connectionScope.trim()
      : ''
  const rawConnectionId =
    typeof rawParams.connectionId === 'string'
      ? rawParams.connectionId.trim()
      : ''

  const [connectionState, setConnectionState] =
    useState<ProviderConnectionSet | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(true)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)

  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null
  const clearedWorkspaceSelectionRef = useRef(false)

  const pickProviderConnections = (
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
  }

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

    const cached = pickProviderConnections(
      getCachedConnections(workspaceId),
      'google'
    )
    if (cached) {
      setConnectionState(sanitizeConnections(cached))
      setConnectionsError(null)
      setConnectionsLoading(false)
    } else {
      setConnectionState(null)
    }

    const unsubscribe = subscribeToConnectionUpdates(
      (snapshot) => {
        if (!active) return
        const googleConnections = pickProviderConnections(snapshot, 'google')
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
        .then((grouped) => {
          if (!active) return
          setConnectionState(
            sanitizeConnections(pickProviderConnections(grouped, 'google'))
          )
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
        const personal = (connectionState.personal ?? []).find(
          (entry) => entry.connected && entry.id === id
        )
        return personal ?? null
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

      const personal = (connectionState.personal ?? []).find(
        (entry) =>
          entry.connected &&
          entry.accountEmail &&
          entry.accountEmail.trim().toLowerCase() === normalized
      )
      if (personal) {
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
        clearedWorkspaceSelectionRef.current = true
        applySheetsParamsPatch({
          oauthConnectionScope: '',
          oauthConnectionId: '',
          accountEmail: '',
          connectionScope: '',
          connectionId: ''
        })
      }
      return
    }

    if (
      clearedWorkspaceSelectionRef.current &&
      !oauthConnectionScope &&
      !oauthConnectionId &&
      !accountEmail
    ) {
      return
    }

    if (!selected) {
      const personal = (connectionState.personal ?? []).find(
        (entry) => entry.connected && entry.id
      )
      if (personal) {
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
          accountEmail: '',
          connectionScope: '',
          connectionId: ''
        })
      }
      return
    }

    const nextScope = selected.scope
    const nextId = selected.id ?? ''
    const nextEmail = selected.accountEmail ?? ''

    const updates: Partial<SheetsActionParams> & {
      connectionScope?: string
      connectionId?: string
    } = {}
    if (oauthConnectionScope !== nextScope) {
      updates.oauthConnectionScope = nextScope
    }
    if ((oauthConnectionId ?? '') !== nextId) {
      updates.oauthConnectionId = nextId
    }
    if ((accountEmail ?? '') !== nextEmail) {
      updates.accountEmail = nextEmail
    }
    if (rawConnectionScope !== nextScope) {
      updates.connectionScope = nextScope
    }
    if (rawConnectionId !== nextId) {
      updates.connectionId = nextId
    }

    if (Object.keys(updates).length > 0) {
      clearedWorkspaceSelectionRef.current = false
      applySheetsParamsPatch(updates)
    }
  }, [
    accountEmail,
    connectionState,
    applySheetsParamsPatch,
    findConnectionByEmail,
    findConnectionById,
    oauthConnectionId,
    oauthConnectionScope,
    rawConnectionId,
    rawConnectionScope
  ])

  useEffect(() => {
    if (
      oauthConnectionScope === 'personal' ||
      oauthConnectionScope === 'workspace'
    ) {
      clearedWorkspaceSelectionRef.current = false
    }
  }, [oauthConnectionScope])

  // Keep personal and workspace references separate; avoid flattening
  const hasAnyGoogleConnection = useMemo(() => {
    if (!connectionState) return false
    const hasPersonal = (connectionState.personal ?? []).some(
      (entry) => entry.connected && entry.id
    )
    const hasWorkspace = connectionState.workspace.some((e) => !!e.id)
    return hasPersonal || hasWorkspace
  }, [connectionState])

  const connectionOptionGroups = useMemo<NodeDropdownOptionGroup[]>(() => {
    if (!connectionState) return []
    const groups: NodeDropdownOptionGroup[] = []
    const personalOptions = (connectionState.personal ?? [])
      .filter((entry) => entry.connected && entry.id)
      .map((entry) => ({
        value: connectionValueKey('personal', entry.id as string),
        label: entry.accountEmail?.trim() || 'Personal Google account'
      }))
    if (personalOptions.length > 0) {
      groups.push({
        label: 'Your connections',
        options: personalOptions
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
            ? `${workspaceName} – ${accountEmail}`
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
      const scope =
        oauthConnectionScope === 'personal' ||
        oauthConnectionScope === 'workspace'
          ? oauthConnectionScope
          : null
      const id = oauthConnectionId?.toString().trim() || ''

      if (!hasAnyGoogleConnection) {
        errors.accountEmail =
          'Connect a Google account in Settings → Integrations'
      } else if (!scope || !id) {
        errors.accountEmail = 'Select a connected Google account'
      } else if (connectionState) {
        if (scope === 'personal') {
          const ok = (connectionState.personal ?? []).some(
            (entry) => entry.connected && entry.id === id
          )
          if (!ok) {
            errors.accountEmail =
              'Selected Google connection is no longer available. Refresh your integrations.'
          }
        }
        if (scope === 'workspace') {
          const ok = connectionState.workspace.some((e) => e.id === id)
          if (!ok) {
            errors.accountEmail =
              'Selected Google connection is no longer available. Refresh your integrations.'
          }
        }
      }
    }

    return errors
  }, [
    connectionsError,
    connectionsLoading,
    columns,
    connectionState,
    hasAnyGoogleConnection,
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
          accountEmail: '',
          connectionScope: '',
          connectionId: ''
        })
        return
      }

      const match = findConnectionById(parsed.scope, parsed.id)
      applySheetsParamsPatch({
        oauthConnectionScope: parsed.scope,
        oauthConnectionId: parsed.id,
        accountEmail: match?.accountEmail ?? '',
        connectionScope: parsed.scope,
        connectionId: parsed.id
      })
    },
    [applySheetsParamsPatch, findConnectionById]
  )

  const handleColumnsChange = useCallback(
    (updatedVars: { key: string; value: string }[]) => {
      applySheetsParamsPatch({ columns: updatedVars })
    },
    [applySheetsParamsPatch]
  )

  const usingWorkspaceCredential = selectedConnection?.scope === 'workspace'
  const errorClass = 'text-xs text-red-500'

  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsOptions, setSheetsOptions] = useState<NodeDropdownOptionGroup[]>(
    []
  )
  const [sheetsError, setSheetsError] = useState<string | null>(null)
  const [debouncedSpreadsheetId, setDebouncedSpreadsheetId] = useState(
    spreadsheetId?.trim() || ''
  )

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)

  // Simple in-component cache to avoid refetching during the same session
  const sheetsCacheRef = useRef<Record<string, NodeDropdownOptionGroup[]>>({})

  useEffect(() => {
    const id = spreadsheetId?.trim() || ''
    const handle = setTimeout(() => setDebouncedSpreadsheetId(id), 300)
    return () => clearTimeout(handle)
  }, [spreadsheetId])

  const openPicker = useCallback(() => {
    setPickerOpen(true)
    setPickerError(null)
    setPickerLoading(true)

    const parsed = parseConnectionValue(selectedConnectionValue)
    const scope = parsed?.scope
    const connId = parsed?.id

    fetchGoogleAccessToken({
      scope: scope === 'personal' || scope === 'workspace' ? scope : undefined,
      connectionId: connId
    })
      .then((token) => {
        ;(window as any).__dsentrPickerToken = token
      })
      .catch((err) => {
        setPickerError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setPickerLoading(false))
  }, [selectedConnectionValue])

  useEffect(() => {
    let active = true
    setSheetsError(null)
    setSheetsOptions([])

    const id = debouncedSpreadsheetId?.trim()
    if (!id) return

    // Check frontend cache first
    const cached = sheetsCacheRef.current[id]
    if (cached) {
      setSheetsOptions(cached)
      setSheetsLoading(false)
      setSheetsError(null)
      return
    }

    const parsedConn = parseConnectionValue(selectedConnectionValue)
    const scope = parsedConn?.scope
    const connId = parsedConn?.id

    setSheetsLoading(true)
    fetchSpreadsheetSheets(id, {
      scope: scope === 'personal' || scope === 'workspace' ? scope : undefined,
      connectionId:
        connId && (scope === 'personal' || scope === 'workspace')
          ? connId
          : undefined
    })
      .then((items) => {
        if (!active) return
        const options = items.map((s) => ({ value: s.id, label: s.title }))
        setSheetsOptions(
          options.length > 0 ? [{ label: 'Worksheets', options }] : []
        )
        // cache the normalized options
        sheetsCacheRef.current[id] =
          options.length > 0 ? [{ label: 'Worksheets', options }] : []
        setSheetsError(null)
      })
      .catch((err) => {
        if (!active) return
        setSheetsError(err instanceof Error ? err.message : String(err))
        setSheetsOptions([])
      })
      .finally(() => {
        if (!active) return
        setSheetsLoading(false)
      })

    return () => {
      active = false
    }
  }, [spreadsheetId, selectedConnectionValue, debouncedSpreadsheetId])

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

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          onClick={() => {
            if (!effectiveCanEdit) return
            openPicker()
          }}
          disabled={!effectiveCanEdit || connectionsLoading}
        >
          <Plus size={14} />
          Choose from Google Drive
        </button>
        {pickerLoading && <span className="text-xs">Loading…</span>}
      </div>
      {pickerOpen && (
        <div className="mt-2 rounded border bg-white p-2 shadow-sm">
          {pickerError && <p className="text-xs text-red-500">{pickerError}</p>}
          {pickerLoading && <p className="text-xs">Loading picker…</p>}

          {!pickerLoading && (
            <DrivePicker
              client-id={import.meta.env.VITE_GOOGLE_CLIENT_ID}
              app-id={import.meta.env.VITE_GOOGLE_APP_ID}
              title="Select a Google Sheet"
              onPicked={(e) => {
                const picked = e.detail?.docs?.[0]
                if (picked?.id) {
                  applySheetsParamsPatch({ spreadsheetId: picked.id })
                }
                setPickerOpen(false)
              }}
              onCanceled={() => setPickerOpen(false)}
              onOauthError={(e) => {
                setPickerError('Google OAuth error')
                console.error(e)
              }}
            >
              <DrivePickerDocsView mime-types="application/vnd.google-apps.spreadsheet" />
            </DrivePicker>
          )}
        </div>
      )}

      {validationErrors.spreadsheetId && (
        <p className={errorClass}>{validationErrors.spreadsheetId}</p>
      )}

      <NodeDropdownField
        options={sheetsOptions}
        value={(() => {
          if (typeof worksheetId === 'string' && worksheetId) return worksheetId
          if (typeof worksheet === 'string' && worksheet) {
            for (const g of sheetsOptions) {
              const found = g.options.find(
                (o) => typeof o !== 'string' && o.label === worksheet
              )
              if (found && typeof found !== 'string') return found.value
            }
          }
          return ''
        })()}
        onChange={(val) => {
          const flat = sheetsOptions
            .flatMap((g) => g.options)
            .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
          const selected = flat.find((o) => o.value === val)
          if (selected) {
            applySheetsParamsPatch({
              worksheet: selected.label,
              worksheetId: selected.value
            })
          } else {
            applySheetsParamsPatch({ worksheet: val, worksheetId: '' })
          }
        }}
        placeholder={
          sheetsLoading
            ? 'Loading worksheets…'
            : sheetsOptions.length > 0
              ? 'Select worksheet'
              : 'No worksheets available'
        }
        disabled={
          !effectiveCanEdit || sheetsLoading || sheetsOptions.length === 0
        }
        loading={sheetsLoading}
        emptyMessage={sheetsError || 'No worksheets available'}
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

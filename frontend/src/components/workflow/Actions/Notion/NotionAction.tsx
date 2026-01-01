import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import deepEqual from 'fast-deep-equal'

import NodeDropdownField, {
  type NodeDropdownOption,
  type NodeDropdownOptionGroup
} from '@/components/ui/InputFields/NodeDropdownField'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import NodeCheckBoxField from '@/components/ui/InputFields/NodeCheckboxField'
import {
  fetchNotionDatabases,
  fetchNotionDatabaseSchema,
  type NotionDatabase,
  type NotionDatabaseSchema,
  type NotionProperty,
  type NotionSelectOption
} from '@/lib/notionApi'
import {
  fetchConnections,
  getCachedConnections,
  subscribeToConnectionUpdates,
  type ConnectionScope,
  type GroupedConnectionsSnapshot,
  type ProviderConnectionSet
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'
import { errorMessage } from '@/lib/errorMessage'

type NotionOperation =
  | 'create_database_row'
  | 'update_database_row'
  | 'create_page'
  | 'query_database'

type PropertyValueEntry = {
  type: string
  value: unknown
}

type NotionFilter = {
  propertyId?: string
  propertyType?: string
  operator?: string
  value?: unknown
}

interface NotionActionProps {
  nodeId: string
  canEdit?: boolean
}

const OPERATION_OPTIONS: NodeDropdownOption[] = [
  { label: 'Create database row', value: 'create_database_row' },
  { label: 'Update database row', value: 'update_database_row' },
  { label: 'Create page', value: 'create_page' },
  { label: 'Query database', value: 'query_database' }
]

const SUPPORTED_PROPERTY_TYPES = new Set([
  'title',
  'rich_text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'email'
])

const CUSTOM_OPTION_VALUE = '__custom__'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toString = (value: unknown) => (typeof value === 'string' ? value : '')

const normalizeScope = (value: unknown): ConnectionScope | '' => {
  const scope = toString(value).trim().toLowerCase()
  return scope === 'personal' || scope === 'workspace' ? scope : ''
}

const normalizeOperation = (value: unknown): NotionOperation => {
  const raw = toString(value).trim().toLowerCase()
  switch (raw) {
    case 'update_database_row':
    case 'create_page':
    case 'query_database':
      return raw as NotionOperation
    default:
      return 'create_database_row'
  }
}

const normalizeParentType = (value: unknown): 'database' | 'page' =>
  toString(value).trim().toLowerCase() === 'page' ? 'page' : 'database'

const optionKey = (option: NotionSelectOption) =>
  option.id?.trim() || option.name?.trim() || ''

const optionLabel = (option: NotionSelectOption) =>
  option.name?.trim() || option.id?.trim() || 'Option'

const describePropertyType = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())

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

const normalizePropertyValue = (value: unknown): PropertyValueEntry | null => {
  if (!isRecord(value)) return null
  const propertyType = toString(value.type || value.propertyType).trim()
  if (!propertyType) return null
  return {
    type: propertyType,
    value: value.value
  }
}

const shouldClearProperty = (value: unknown) => {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.keys(value).length === 0
  return false
}

const normalizeMultiValues = (
  value: unknown
): Array<{ id?: string; name?: string } | string> => {
  if (!Array.isArray(value)) return []
  const output: Array<{ id?: string; name?: string } | string> = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim()
      if (trimmed) {
        output.push(trimmed)
      }
      continue
    }
    if (isRecord(entry)) {
      const id = toString(entry.id).trim()
      const name = toString(entry.name).trim()
      if (id) {
        output.push({ id })
      } else if (name) {
        output.push({ name })
      }
    }
  }
  return output
}

const normalizeFilter = (value: unknown): NotionFilter => {
  if (!isRecord(value)) return {}
  return {
    propertyId: toString(value.propertyId || value.property).trim(),
    propertyType: toString(value.propertyType || value.type).trim(),
    operator: toString(value.operator).trim(),
    value: value.value
  }
}

export default function NotionAction({
  nodeId,
  canEdit = true
}: NotionActionProps) {
  const params = useActionParams<Record<string, unknown>>(nodeId, 'notion')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit

  const operation = normalizeOperation(params.operation)
  const connectionScope = normalizeScope(params.connectionScope)
  const connectionId = toString(params.connectionId).trim()
  const databaseId = toString(params.databaseId).trim()
  const pageId = toString(params.pageId).trim()
  const parentType = normalizeParentType(params.parentType)
  const parentDatabaseId = toString(params.parentDatabaseId).trim()
  const parentPageId = toString(params.parentPageId).trim()
  const title = toString(params.title)
  const limit = toString(params.limit)
  const filter = normalizeFilter(params.filter)

  const propertyEntries = useMemo(() => {
    if (!isRecord(params.properties)) return {}
    const entries: Record<string, PropertyValueEntry> = {}
    Object.entries(params.properties).forEach(([key, value]) => {
      const normalized = normalizePropertyValue(value)
      if (!normalized) return
      entries[key] = normalized
    })
    return entries
  }, [params.properties])

  const readCurrentParams = useCallback(() => {
    const state = useWorkflowStore.getState()
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    if (node?.data && isRecord(node.data)) {
      const rawParams = (node.data as Record<string, unknown>).params
      if (isRecord(rawParams)) {
        return rawParams
      }
    }
    return isRecord(params) ? params : {}
  }, [nodeId, params])

  const applyParamsPatch = useCallback(
    (patch: Record<string, unknown>) => {
      if (!effectiveCanEdit) return
      const currentParams = readCurrentParams()
      let hasChanges = false
      for (const [key, value] of Object.entries(patch)) {
        if (!deepEqual(currentParams[key], value)) {
          hasChanges = true
          break
        }
      }
      if (!hasChanges) return
      updateNodeData(nodeId, {
        params: { ...currentParams, ...patch },
        dirty: true
      })
    },
    [effectiveCanEdit, nodeId, readCurrentParams, updateNodeData]
  )

  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null

  const [connectionState, setConnectionState] =
    useState<ProviderConnectionSet | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(true)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)

  const sanitizeConnections = useCallback(
    (connections: ProviderConnectionSet) => {
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
      const workspace = (connections.workspace ?? [])
        .filter((entry) => !entry.requiresReconnect)
        .map((entry) => ({ ...entry }))
      return {
        personal,
        workspace
      }
    },
    []
  )

  const pickProviderConnections = useCallback(
    (
      snapshot: GroupedConnectionsSnapshot | null
    ): ProviderConnectionSet | null => {
      if (!snapshot) return null
      const personal = (snapshot.personal ?? [])
        .filter((entry) => entry.provider === 'notion')
        .map((entry) => ({ ...entry }))
      const workspace = (snapshot.workspace ?? [])
        .filter((entry) => entry.provider === 'notion')
        .map((entry) => ({ ...entry }))
      if (personal.length === 0 && workspace.length === 0) {
        return null
      }
      return { personal, workspace }
    },
    []
  )

  useEffect(() => {
    let active = true
    const cached = pickProviderConnections(getCachedConnections(workspaceId))
    if (cached) {
      setConnectionState(sanitizeConnections(cached))
      setConnectionsLoading(false)
    } else {
      setConnectionState(null)
    }

    const unsubscribe = subscribeToConnectionUpdates(
      (snapshot) => {
        if (!active) return
        const notionConnections = pickProviderConnections(snapshot)
        if (!notionConnections) {
          setConnectionState(null)
          setConnectionsLoading(false)
          return
        }
        setConnectionState(sanitizeConnections(notionConnections))
        setConnectionsLoading(false)
        setConnectionsError(null)
      },
      { workspaceId }
    )

    if (!cached) {
      setConnectionsLoading(true)
      fetchConnections({ workspaceId })
        .then((grouped) => {
          if (!active) return
          const next = pickProviderConnections(grouped)
          setConnectionState(next ? sanitizeConnections(next) : null)
          setConnectionsError(null)
        })
        .catch((err) => {
          if (!active) return
          setConnectionsError(errorMessage(err))
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
  }, [pickProviderConnections, sanitizeConnections, workspaceId])

  const selectedConnection = useMemo(() => {
    if (!connectionState || !connectionScope || !connectionId) return null
    if (connectionScope === 'personal') {
      return (
        connectionState.personal.find((entry) => entry.id === connectionId) ??
        null
      )
    }
    if (connectionScope === 'workspace') {
      return (
        connectionState.workspace.find((entry) => entry.id === connectionId) ??
        null
      )
    }
    return null
  }, [connectionId, connectionScope, connectionState])

  const formatConnectionLabel = (
    name?: string,
    email?: string,
    fallback = 'Notion'
  ) => {
    const base = name?.trim() || fallback
    const mail = email?.trim()
    return mail && !base.includes(mail) ? `${base} (${mail})` : base
  }

  const connectionOptions = useMemo<NodeDropdownOptionGroup[]>(() => {
    if (!connectionState) return []
    const groups: NodeDropdownOptionGroup[] = []
    if (connectionState.personal.length > 0) {
      groups.push({
        label: 'Personal connections',
        options: connectionState.personal.map((entry) => {
          const label = formatConnectionLabel(
            entry.ownerName,
            entry.ownerEmail || entry.accountEmail,
            'Personal Notion'
          )
          const id = entry.id ?? entry.connectionId ?? ''
          return {
            label: entry.requiresReconnect ? `${label} (reconnect)` : label,
            value: connectionValueKey('personal', id),
            disabled: !id || entry.requiresReconnect
          }
        })
      })
    }
    if (connectionState.workspace.length > 0) {
      groups.push({
        label: 'Workspace connections',
        options: connectionState.workspace.map((entry) => {
          const label =
            entry.workspaceName || entry.sharedByName || 'Workspace Notion'
          const id = entry.id ?? entry.workspaceConnectionId ?? ''
          return {
            label: entry.requiresReconnect ? `${label} (reconnect)` : label,
            value: connectionValueKey('workspace', id || ''),
            disabled: !id || entry.requiresReconnect
          }
        })
      })
    }
    return groups
  }, [connectionState])

  const selectedConnectionValue = useMemo(() => {
    if (!connectionScope || !connectionId) return ''
    return connectionValueKey(connectionScope, connectionId)
  }, [connectionId, connectionScope])

  const handleConnectionChange = useCallback(
    (value: string) => {
      const parsed = parseConnectionValue(value)
      if (!parsed) {
        applyParamsPatch({
          connectionScope: '',
          connectionId: '',
          databaseId: '',
          parentDatabaseId: '',
          parentPageId: '',
          pageId: '',
          properties: {},
          filter: {}
        })
        return
      }
      const changed =
        parsed.scope !== connectionScope || parsed.id !== connectionId
      const patch: Record<string, unknown> = {
        connectionScope: parsed.scope,
        connectionId: parsed.id
      }
      if (changed) {
        patch.databaseId = ''
        patch.parentDatabaseId = ''
        patch.parentPageId = ''
        patch.pageId = ''
        patch.properties = {}
        patch.filter = {}
      }
      applyParamsPatch(patch)
    },
    [applyParamsPatch, connectionId, connectionScope]
  )

  const activeConnection = useMemo(() => {
    if (!connectionScope || !connectionId) return null
    return { scope: connectionScope, id: connectionId }
  }, [connectionId, connectionScope])

  const needsDatabaseSelection =
    operation === 'create_database_row' ||
    operation === 'update_database_row' ||
    operation === 'query_database' ||
    (operation === 'create_page' && parentType === 'database')

  const activeDatabaseId = useMemo(() => {
    if (!needsDatabaseSelection) return ''
    if (operation === 'create_page' && parentType === 'database') {
      return parentDatabaseId
    }
    return databaseId
  }, [
    databaseId,
    needsDatabaseSelection,
    operation,
    parentDatabaseId,
    parentType
  ])

  const [databaseSearch, setDatabaseSearch] = useState('')
  const [databaseLoading, setDatabaseLoading] = useState(false)
  const [databaseError, setDatabaseError] = useState<string | null>(null)
  const [databaseList, setDatabaseList] = useState<NotionDatabase[]>([])
  const [databaseCursor, setDatabaseCursor] = useState<string | null>(null)
  const [databaseHasMore, setDatabaseHasMore] = useState(false)

  useEffect(() => {
    if (!activeConnection || !needsDatabaseSelection) {
      setDatabaseList([])
      setDatabaseCursor(null)
      setDatabaseHasMore(false)
      setDatabaseLoading(false)
      setDatabaseError(null)
      return
    }
    let active = true
    setDatabaseLoading(true)
    setDatabaseError(null)
    const timeout = setTimeout(() => {
      fetchNotionDatabases({
        scope: activeConnection.scope,
        connectionId: activeConnection.id,
        search: databaseSearch,
        cursor: null
      })
        .then((payload) => {
          if (!active) return
          setDatabaseList(payload.databases)
          setDatabaseCursor(payload.nextCursor ?? null)
          setDatabaseHasMore(payload.hasMore)
        })
        .catch((err) => {
          if (!active) return
          setDatabaseError(errorMessage(err))
          setDatabaseList([])
          setDatabaseCursor(null)
          setDatabaseHasMore(false)
        })
        .finally(() => {
          if (!active) return
          setDatabaseLoading(false)
        })
    }, 250)

    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [activeConnection, databaseSearch, needsDatabaseSelection])

  const handleLoadMoreDatabases = useCallback(() => {
    if (!activeConnection || !databaseCursor) return
    setDatabaseLoading(true)
    setDatabaseError(null)
    fetchNotionDatabases({
      scope: activeConnection.scope,
      connectionId: activeConnection.id,
      search: databaseSearch,
      cursor: databaseCursor
    })
      .then((payload) => {
        setDatabaseList((prev) => [...prev, ...payload.databases])
        setDatabaseCursor(payload.nextCursor ?? null)
        setDatabaseHasMore(payload.hasMore)
      })
      .catch((err) => {
        setDatabaseError(errorMessage(err))
      })
      .finally(() => {
        setDatabaseLoading(false)
      })
  }, [activeConnection, databaseCursor, databaseSearch])

  const databaseOptions = useMemo<NodeDropdownOption[]>(() => {
    return databaseList.map((db) => ({
      label: db.name || db.id,
      value: db.id
    }))
  }, [databaseList])

  const databaseLabel =
    operation === 'create_page' && parentType === 'database'
      ? 'Parent database'
      : 'Database'

  const handleDatabaseChange = useCallback(
    (value: string) => {
      if (operation === 'create_page' && parentType === 'database') {
        applyParamsPatch({ parentDatabaseId: value })
        return
      }
      applyParamsPatch({ databaseId: value })
    },
    [applyParamsPatch, operation, parentType]
  )

  const [schema, setSchema] = useState<NotionDatabaseSchema | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeConnection || !activeDatabaseId) {
      setSchema(null)
      setSchemaLoading(false)
      setSchemaError(null)
      return
    }

    let active = true
    setSchemaLoading(true)
    setSchemaError(null)

    fetchNotionDatabaseSchema(activeDatabaseId, {
      scope: activeConnection.scope,
      connectionId: activeConnection.id
    })
      .then((payload) => {
        if (!active) return

        const normalized: NotionDatabaseSchema = {
          ...payload,
          properties: (payload.properties ?? []).map((prop: any) => {
            const type = (prop.property_type ?? prop.propertyType ?? '')
              .trim()
              .toLowerCase()

            return {
              ...prop,
              property_type: type,
              is_title: Boolean(prop.is_title ?? prop.isTitle)
            }
          })
        }

        setSchema(normalized)
      })
      .catch((err) => {
        if (!active) return
        setSchemaError(errorMessage(err))
        setSchema(null)
      })
      .finally(() => {
        if (!active) return
        setSchemaLoading(false)
      })

    return () => {
      active = false
    }
  }, [activeConnection, activeDatabaseId])

  const lastDatabaseRef = useRef<string>('')
  useEffect(() => {
    const prev = lastDatabaseRef.current
    const next = activeDatabaseId || ''
    if (!prev) {
      lastDatabaseRef.current = next
      return
    }
    if (prev !== next) {
      applyParamsPatch({
        properties: {},
        filter: {}
      })
      lastDatabaseRef.current = next
    }
  }, [activeDatabaseId, applyParamsPatch])

  const handlePropertyChange = useCallback(
    (property: NotionProperty, value: unknown) => {
      const current = readCurrentParams()
      const currentProperties = isRecord(current.properties)
        ? { ...current.properties }
        : {}

      if (property.property_type === 'checkbox') {
        currentProperties[property.property_id] = {
          type: property.property_type,
          value
        }
      } else if (shouldClearProperty(value)) {
        delete currentProperties[property.property_id]
      } else {
        currentProperties[property.property_id] = {
          type: property.property_type,
          value
        }
      }

      applyParamsPatch({ properties: currentProperties })
    },
    [applyParamsPatch, readCurrentParams]
  )

  const schemaProperties = useMemo(() => {
    const props = schema?.properties ?? []
    const supported = props.filter(
      (prop) =>
        typeof prop.property_type === 'string' &&
        SUPPORTED_PROPERTY_TYPES.has(prop.property_type)
    )

    return supported.sort((a, b) => {
      if (a.is_title && !b.is_title) return -1
      if (!a.is_title && b.is_title) return 1
      return a.name.localeCompare(b.name)
    })
  }, [schema?.properties])

  const showProperties =
    operation === 'create_database_row' ||
    operation === 'update_database_row' ||
    (operation === 'create_page' && parentType === 'database')

  const filterPropertyOptions = useMemo<NodeDropdownOption[]>(() => {
    return schemaProperties.map((prop) => ({
      label: `${prop.name} (${describePropertyType(prop.property_type)})`,
      value: prop.property_id
    }))
  }, [schemaProperties])

  const handleFilterPatch = useCallback(
    (patch: Partial<NotionFilter>) => {
      const current = readCurrentParams()
      const existing = normalizeFilter(current.filter)
      applyParamsPatch({
        filter: {
          ...existing,
          ...patch
        }
      })
    },
    [applyParamsPatch, readCurrentParams]
  )

  const filterProperty = schemaProperties.find(
    (prop) => prop.property_id === filter.propertyId
  )

  const filterOperator = filter.operator || 'equals'
  const operatorOptions: NodeDropdownOption[] = [
    { label: 'Equals', value: 'equals' },
    { label: 'Contains', value: 'contains' },
    { label: 'Is empty', value: 'is_empty' },
    { label: 'Is not empty', value: 'is_not_empty' }
  ]

  const shouldShowFilterValue =
    filterOperator !== 'is_empty' && filterOperator !== 'is_not_empty'

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Connection
        </label>
        <div className="mt-2">
          <NodeDropdownField
            options={connectionOptions}
            value={selectedConnectionValue}
            onChange={handleConnectionChange}
            placeholder="Select a Notion connection"
            loading={connectionsLoading}
            disabled={!effectiveCanEdit}
            emptyMessage="No Notion connections available"
            searchable
          />
        </div>
        {connectionsError ? (
          <p className="mt-2 text-xs text-red-500">{connectionsError}</p>
        ) : null}
        {selectedConnection?.scope === 'workspace' ? (
          <p className="mt-2 text-xs text-zinc-500">
            Using workspace connection
            {selectedConnection.workspaceName
              ? ` "${selectedConnection.workspaceName}".`
              : '.'}
          </p>
        ) : null}
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Operation
        </label>
        <div className="mt-2">
          <NodeDropdownField
            options={OPERATION_OPTIONS}
            value={operation}
            onChange={(value) => applyParamsPatch({ operation: value })}
            placeholder="Select an operation"
            disabled={!effectiveCanEdit}
          />
        </div>
      </div>

      {needsDatabaseSelection ? (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {databaseLabel}
          </label>
          <div className="mt-2 space-y-2">
            <NodeInputField
              placeholder="Search databases..."
              value={databaseSearch}
              onChange={setDatabaseSearch}
              disabled={!effectiveCanEdit || !activeConnection}
            />
            <NodeDropdownField
              options={databaseOptions}
              value={activeDatabaseId}
              onChange={handleDatabaseChange}
              placeholder="Select a database"
              loading={databaseLoading}
              disabled={!effectiveCanEdit || !activeConnection}
              emptyMessage="No databases found"
              searchable
            />
          </div>
          {databaseError ? (
            <p className="mt-2 text-xs text-red-500">{databaseError}</p>
          ) : null}
          {databaseHasMore ? (
            <button
              type="button"
              onClick={handleLoadMoreDatabases}
              disabled={!effectiveCanEdit || databaseLoading}
              className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60"
            >
              Load more databases
            </button>
          ) : null}
        </div>
      ) : null}

      {operation === 'update_database_row' ? (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Page ID
          </label>
          <div className="mt-2">
            <NodeInputField
              value={pageId}
              onChange={(value) => applyParamsPatch({ pageId: value })}
              placeholder="Notion page ID"
              disabled={!effectiveCanEdit}
            />
          </div>
        </div>
      ) : null}

      {operation === 'create_page' ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Parent type
            </label>
            <div className="mt-2">
              <NodeDropdownField
                options={[
                  { label: 'Database', value: 'database' },
                  { label: 'Page', value: 'page' }
                ]}
                value={parentType}
                onChange={(value) => applyParamsPatch({ parentType: value })}
                disabled={!effectiveCanEdit}
              />
            </div>
          </div>
          {parentType === 'page' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Parent page ID
                </label>
                <div className="mt-2">
                  <NodeInputField
                    value={parentPageId}
                    onChange={(value) =>
                      applyParamsPatch({ parentPageId: value })
                    }
                    placeholder="Notion page ID"
                    disabled={!effectiveCanEdit}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Title
                </label>
                <div className="mt-2">
                  <NodeInputField
                    value={title}
                    onChange={(value) => applyParamsPatch({ title: value })}
                    placeholder="Page title"
                    disabled={!effectiveCanEdit}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showProperties ? (
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Properties
            </label>
            {schemaLoading ? (
              <span className="text-xs text-zinc-500">Loading schema...</span>
            ) : null}
          </div>
          {schemaError ? (
            <p className="mt-2 text-xs text-red-500">{schemaError}</p>
          ) : null}
          {!schemaLoading && !schema && activeDatabaseId ? (
            <p className="mt-2 text-xs text-zinc-500">
              Select a database to load its properties.
            </p>
          ) : null}
          <div className="mt-3 space-y-3">
            {schemaProperties.map((property) => {
              const entry = propertyEntries[property.property_id]
              const entryValue = entry?.value
              const isTitle = property.is_title
              return (
                <div
                  key={property.property_id}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                      {property.name}
                      {isTitle ? ' (Title)' : ''}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {describePropertyType(property.property_type)}
                    </div>
                  </div>
                  <div className="mt-2">
                    {property.property_type === 'checkbox' ? (
                      <NodeCheckBoxField
                        checked={Boolean(entryValue)}
                        onChange={(value) =>
                          handlePropertyChange(property, value)
                        }
                      >
                        Set checkbox
                      </NodeCheckBoxField>
                    ) : property.property_type === 'select' ? (
                      <NotionSelectField
                        property={property}
                        value={entryValue}
                        onChange={(value) =>
                          handlePropertyChange(property, value)
                        }
                        disabled={!effectiveCanEdit}
                      />
                    ) : property.property_type === 'multi_select' ? (
                      <NotionMultiSelectField
                        property={property}
                        value={entryValue}
                        onChange={(value) =>
                          handlePropertyChange(property, value)
                        }
                        disabled={!effectiveCanEdit}
                      />
                    ) : (
                      <NodeInputField
                        value={toString(entryValue)}
                        onChange={(value) =>
                          handlePropertyChange(property, value)
                        }
                        placeholder={`Enter ${describePropertyType(
                          property.property_type
                        )}`}
                        disabled={!effectiveCanEdit}
                      />
                    )}
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-400">
                    ID: {property.property_id}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {operation === 'query_database' ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Filter property
            </label>
            <div className="mt-2">
              <NodeDropdownField
                options={filterPropertyOptions}
                value={filter.propertyId || ''}
                onChange={(value) => {
                  const property = schemaProperties.find(
                    (prop) => prop.property_id === value
                  )
                  handleFilterPatch({
                    propertyId: value,
                    propertyType: property?.property_type || '',
                    value: ''
                  })
                }}
                placeholder="Select a property"
                disabled={!effectiveCanEdit || !activeDatabaseId}
                emptyMessage="Select a database first"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Operator
            </label>
            <div className="mt-2">
              <NodeDropdownField
                options={operatorOptions}
                value={filterOperator}
                onChange={(value) =>
                  handleFilterPatch({
                    operator: value,
                    value: shouldShowFilterValue ? filter.value : undefined
                  })
                }
                disabled={!effectiveCanEdit || !filter.propertyId}
              />
            </div>
          </div>

          {shouldShowFilterValue ? (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Value
              </label>
              <div className="mt-2">
                {filterProperty?.property_type === 'checkbox' ? (
                  <NodeDropdownField
                    options={[
                      { label: 'True', value: 'true' },
                      { label: 'False', value: 'false' }
                    ]}
                    value={
                      typeof filter.value === 'boolean'
                        ? filter.value
                          ? 'true'
                          : 'false'
                        : toString(filter.value) || ''
                    }
                    onChange={(value) =>
                      handleFilterPatch({ value: value === 'true' })
                    }
                    disabled={!effectiveCanEdit}
                  />
                ) : filterProperty?.property_type === 'select' ||
                  filterProperty?.property_type === 'multi_select' ? (
                  <NodeDropdownField
                    options={(filterProperty.options ?? []).map((option) => ({
                      label: optionLabel(option),
                      value: optionLabel(option)
                    }))}
                    value={toString(filter.value)}
                    onChange={(value) => handleFilterPatch({ value })}
                    placeholder="Select an option"
                    disabled={!effectiveCanEdit}
                    emptyMessage="No options available"
                  />
                ) : (
                  <NodeInputField
                    value={toString(filter.value)}
                    onChange={(value) => handleFilterPatch({ value })}
                    placeholder="Filter value"
                    disabled={!effectiveCanEdit}
                  />
                )}
              </div>
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Limit
            </label>
            <div className="mt-2">
              <NodeInputField
                value={limit}
                onChange={(value) => applyParamsPatch({ limit: value })}
                placeholder="25"
                disabled={!effectiveCanEdit}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface NotionSelectFieldProps {
  property: NotionProperty
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

function NotionSelectField({
  property,
  value,
  onChange,
  disabled = false
}: NotionSelectFieldProps) {
  const options = useMemo(() => property.options ?? [], [property.options])
  const optionMap = useMemo(() => {
    const map = new Map<string, NotionSelectOption>()
    options.forEach((option) => {
      const key = optionKey(option)
      if (key) {
        map.set(key, option)
      }
    })
    return map
  }, [options])

  const { selectedValue, customValue } = useMemo(() => {
    if (isRecord(value)) {
      const id = toString(value.id).trim()
      const name = toString(value.name).trim()
      const key = id || name
      if (key && optionMap.has(key)) {
        return { selectedValue: key, customValue: '' }
      }
      return { selectedValue: CUSTOM_OPTION_VALUE, customValue: key }
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return { selectedValue: '', customValue: '' }
      if (optionMap.has(trimmed)) {
        return { selectedValue: trimmed, customValue: '' }
      }
      return { selectedValue: CUSTOM_OPTION_VALUE, customValue: trimmed }
    }
    return { selectedValue: '', customValue: '' }
  }, [optionMap, value])

  const dropdownOptions: NodeDropdownOption[] = options
    .map((option) => ({
      label: optionLabel(option),
      value: optionKey(option)
    }))
    .filter((option) => option.value)

  if (dropdownOptions.length > 0) {
    dropdownOptions.push({
      label: 'Custom value',
      value: CUSTOM_OPTION_VALUE
    })
  }

  const handleSelectChange = (nextValue: string) => {
    if (nextValue === CUSTOM_OPTION_VALUE) {
      onChange(customValue)
      return
    }
    const option = optionMap.get(nextValue)
    if (!option) {
      onChange(nextValue)
      return
    }
    if (option.id) {
      onChange({ id: option.id })
    } else if (option.name) {
      onChange({ name: option.name })
    } else {
      onChange(nextValue)
    }
  }

  return (
    <div className="space-y-2">
      {dropdownOptions.length > 0 ? (
        <NodeDropdownField
          options={dropdownOptions}
          value={selectedValue}
          onChange={handleSelectChange}
          placeholder="Select an option"
          disabled={disabled}
          searchable
        />
      ) : null}
      {dropdownOptions.length === 0 || selectedValue === CUSTOM_OPTION_VALUE ? (
        <NodeInputField
          value={customValue}
          onChange={(next) => onChange(next)}
          placeholder="Custom value"
          disabled={disabled}
        />
      ) : null}
    </div>
  )
}

interface NotionMultiSelectFieldProps {
  property: NotionProperty
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

function NotionMultiSelectField({
  property,
  value,
  onChange,
  disabled = false
}: NotionMultiSelectFieldProps) {
  const options = useMemo(() => property.options ?? [], [property.options])
  const [pendingOption, setPendingOption] = useState('')
  const [customValue, setCustomValue] = useState('')

  const selections = useMemo(() => normalizeMultiValues(value), [value])

  const selectedKeys = useMemo(() => {
    return new Set(
      selections
        .map((entry) => {
          if (typeof entry === 'string') return entry.trim()
          return entry.id?.trim() || entry.name?.trim() || ''
        })
        .filter(Boolean)
    )
  }, [selections])

  const availableOptions = useMemo(() => {
    return options.filter((option) => {
      const key = optionKey(option)
      return key && !selectedKeys.has(key)
    })
  }, [options, selectedKeys])

  const addSelection = (entry: { id?: string; name?: string } | string) => {
    const next = [...selections, entry]
    onChange(next)
  }

  const handleAddOption = () => {
    if (!pendingOption) return
    const option = availableOptions.find(
      (candidate) => optionKey(candidate) === pendingOption
    )
    if (!option) return
    if (option.id) {
      addSelection({ id: option.id })
    } else if (option.name) {
      addSelection({ name: option.name })
    }
    setPendingOption('')
  }

  const handleAddCustom = () => {
    const trimmed = customValue.trim()
    if (!trimmed || selectedKeys.has(trimmed)) return
    addSelection(trimmed)
    setCustomValue('')
  }

  const handleRemove = (key: string) => {
    const next = selections.filter((entry) => {
      if (typeof entry === 'string') return entry.trim() !== key
      const entryKey = entry.id?.trim() || entry.name?.trim() || ''
      return entryKey !== key
    })
    onChange(next)
  }

  const renderLabel = (entry: { id?: string; name?: string } | string) => {
    if (typeof entry === 'string') return entry
    const id = entry.id?.trim() || ''
    const name = entry.name?.trim() || ''
    const match = options.find((opt) => optionKey(opt) === (id || name))
    return match ? optionLabel(match) : name || id
  }

  return (
    <div className="space-y-2">
      {selections.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selections.map((entry) => {
            const key =
              typeof entry === 'string'
                ? entry.trim()
                : entry.id?.trim() || entry.name?.trim() || ''
            if (!key) return null
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {renderLabel(entry)}
                <button
                  type="button"
                  onClick={() => handleRemove(key)}
                  className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  disabled={disabled}
                >
                  x
                </button>
              </span>
            )
          })}
        </div>
      ) : null}

      {availableOptions.length > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <NodeDropdownField
              options={availableOptions.map((option) => ({
                label: optionLabel(option),
                value: optionKey(option)
              }))}
              value={pendingOption}
              onChange={(value) => setPendingOption(value)}
              placeholder="Select an option"
              disabled={disabled}
              searchable
            />
          </div>
          <button
            type="button"
            onClick={handleAddOption}
            disabled={disabled || !pendingOption}
            className="rounded border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-700 hover:border-blue-400 hover:text-blue-600 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200"
          >
            Add
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <NodeInputField
            value={customValue}
            onChange={(value) => setCustomValue(value)}
            placeholder="Custom option"
            disabled={disabled}
          />
        </div>
        <button
          type="button"
          onClick={handleAddCustom}
          disabled={disabled || !customValue.trim()}
          className="rounded border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-700 hover:border-blue-400 hover:text-blue-600 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200"
        >
          Add
        </button>
      </div>
    </div>
  )
}

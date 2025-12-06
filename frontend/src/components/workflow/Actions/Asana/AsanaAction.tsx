import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock, Globe2 } from 'lucide-react'
import deepEqual from 'fast-deep-equal'

import NodeDropdownField, {
  type NodeDropdownOption,
  type NodeDropdownOptionGroup
} from '@/components/ui/InputFields/NodeDropdownField'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import NodeTextAreaField from '@/components/ui/InputFields/NodeTextAreaField'
import NodeCheckBoxField from '@/components/ui/InputFields/NodeCheckboxField'
import KeyValuePair from '@/components/ui/ReactFlow/KeyValuePair'
import {
  fetchAsanaProjects,
  fetchAsanaSections,
  fetchAsanaTags,
  fetchAsanaTeams,
  fetchAsanaUsers,
  fetchAsanaWorkspaces,
  type AsanaConnectionOptions,
  type AsanaProject,
  type AsanaSection,
  type AsanaTag,
  type AsanaTeam,
  type AsanaUser,
  type AsanaWorkspace
} from '@/lib/asanaApi'
import {
  fetchConnections,
  getCachedConnections,
  subscribeToConnectionUpdates,
  type GroupedConnectionsSnapshot,
  type ProviderConnectionSet
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'
import { ScheduleCalendar } from '@/components/ui/schedule/ScheduleCalendar'
import { ScheduleTimePicker } from '@/components/ui/schedule/ScheduleTimePicker'
import { ScheduleTimezonePicker } from '@/components/ui/schedule/ScheduleTimezonePicker'
import {
  formatDisplayDate,
  formatDisplayTime,
  getInitialMonth,
  parseTime,
  toISODateString,
  toTimeString,
  type CalendarMonth
} from '@/components/ui/schedule/utils'

type AsanaConnectionScope = 'personal' | 'workspace'

type AsanaOperation =
  | 'createProject'
  | 'deleteProject'
  | 'getProject'
  | 'listProjects'
  | 'updateProject'
  | 'createSubtask'
  | 'listSubtasks'
  | 'createTask'
  | 'deleteTask'
  | 'getTask'
  | 'listTasks'
  | 'moveTask'
  | 'searchTasks'
  | 'updateTask'
  | 'addComment'
  | 'removeComment'
  | 'addTaskProject'
  | 'removeTaskProject'
  | 'addTaskTag'
  | 'removeTaskTag'
  | 'getUser'
  | 'listUsers'

type KeyValue = { key: string; value: string }

interface AsanaConnectionSelection {
  connectionScope: AsanaConnectionScope
  connectionId?: string
  accountEmail?: string
}

export interface AsanaActionParams extends Record<string, unknown> {
  operation: AsanaOperation
  connectionScope?: string
  connectionId?: string
  connection?: AsanaConnectionSelection
  workspaceGid?: string
  projectGid?: string
  taskGid?: string
  parentTaskGid?: string
  sectionGid?: string
  tagGid?: string
  userGid?: string
  storyGid?: string
  teamGid?: string
  name?: string
  notes?: string
  dueOn?: string
  dueAt?: string
  assignee?: string
  query?: string
  completed?: boolean
  archived?: boolean
  limit?: string | number
  additionalFields?: KeyValue[]
  hasValidationErrors?: boolean
}

const DEFAULT_PARAMS: AsanaActionParams = {
  operation: 'createTask',
  connectionScope: '',
  connectionId: '',
  connection: undefined,
  workspaceGid: '',
  projectGid: '',
  taskGid: '',
  parentTaskGid: '',
  sectionGid: '',
  tagGid: '',
  userGid: '',
  storyGid: '',
  teamGid: '',
  name: '',
  notes: '',
  dueOn: '',
  dueAt: '',
  assignee: '',
  query: '',
  completed: false,
  archived: false,
  limit: '',
  additionalFields: [],
  hasValidationErrors: false
}

type DateTimeParts = {
  date: string
  hour: number
  minute: number
  second: number
  valid: boolean
}

const parseIsoDateTime = (value?: string | null): DateTimeParts => {
  if (!value) {
    return { date: '', hour: 0, minute: 0, second: 0, valid: false }
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return { date: '', hour: 0, minute: 0, second: 0, valid: false }
  }
  return {
    date: parsed.toISOString().slice(0, 10),
    hour: parsed.getUTCHours(),
    minute: parsed.getUTCMinutes(),
    second: parsed.getUTCSeconds(),
    valid: true
  }
}

const buildIsoDateTime = (
  dateStr: string,
  hour: number,
  minute: number,
  second: number,
  timezone?: string
) => {
  if (!dateStr) return undefined
  const [yearStr, monthStr, dayStr] = dateStr.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return undefined
  }
  const baseUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (Number.isNaN(baseUtc.getTime())) {
    return undefined
  }
  if (!timezone || timezone === 'UTC') {
    return baseUtc.toISOString()
  }
  try {
    const zoned = new Date(
      baseUtc.toLocaleString('en-US', { timeZone: timezone })
    )
    const diff = baseUtc.getTime() - zoned.getTime()
    const adjusted = new Date(baseUtc.getTime() - diff)
    if (Number.isNaN(adjusted.getTime())) {
      return baseUtc.toISOString()
    }
    return adjusted.toISOString()
  } catch {
    return baseUtc.toISOString()
  }
}

type FieldKey =
  | 'workspaceGid'
  | 'projectGid'
  | 'taskGid'
  | 'parentTaskGid'
  | 'sectionGid'
  | 'tagGid'
  | 'userGid'
  | 'storyGid'
  | 'teamGid'
  | 'name'
  | 'notes'
  | 'dueOn'
  | 'dueAt'
  | 'assignee'
  | 'query'
  | 'completed'
  | 'archived'
  | 'limit'
  | 'additionalFields'

interface FieldMeta {
  label: string
  placeholder?: string
  helper?: string
  kind?: 'textarea' | 'checkbox' | 'number'
}

const FIELD_META: Record<FieldKey, FieldMeta> = {
  workspaceGid: {
    label: 'Workspace GID',
    placeholder: 'e.g., 12025512345'
  },
  projectGid: {
    label: 'Project GID',
    placeholder: 'Project identifier'
  },
  taskGid: {
    label: 'Task GID',
    placeholder: 'Task identifier'
  },
  parentTaskGid: {
    label: 'Parent Task GID',
    placeholder: 'Parent task to attach a subtask'
  },
  sectionGid: {
    label: 'Section GID',
    placeholder: 'Target section/column'
  },
  tagGid: {
    label: 'Tag GID',
    placeholder: 'Tag identifier'
  },
  userGid: {
    label: 'User GID',
    placeholder: 'User identifier'
  },
  storyGid: {
    label: 'Comment/Story GID',
    placeholder: 'Comment identifier'
  },
  teamGid: {
    label: 'Team GID',
    placeholder: 'Optional team filter'
  },
  name: {
    label: 'Name',
    placeholder: 'Title for the project or task'
  },
  notes: {
    label: 'Notes/Description',
    placeholder: 'Optional description',
    kind: 'textarea'
  },
  dueOn: {
    label: 'Due On (date)',
    placeholder: 'YYYY-MM-DD'
  },
  dueAt: {
    label: 'Due At (datetime)',
    placeholder: 'ISO8601 timestamp (UTC)'
  },
  assignee: {
    label: 'Assignee GID',
    placeholder: 'User to assign'
  },
  query: {
    label: 'Search text',
    placeholder: 'Words to match in task search'
  },
  completed: {
    label: 'Mark completed',
    kind: 'checkbox'
  },
  archived: {
    label: 'Archived',
    kind: 'checkbox'
  },
  limit: {
    label: 'Max results',
    placeholder: 'Optional limit (1-100)',
    kind: 'number'
  },
  additionalFields: {
    label: 'Additional fields',
    helper:
      'Optional key/value pairs sent with the request for advanced Asana attributes.'
  }
}

type OperationConfig = {
  label: string
  required: FieldKey[]
  optional?: FieldKey[]
}

const OPERATION_OPTIONS: Array<{ value: AsanaOperation; label: string }> = [
  { value: 'createProject', label: 'Projects - Create project' },
  { value: 'updateProject', label: 'Projects - Update project' },
  { value: 'getProject', label: 'Projects - Get project' },
  { value: 'listProjects', label: 'Projects - List projects' },
  { value: 'deleteProject', label: 'Projects - Delete project' },
  { value: 'createTask', label: 'Tasks - Create task' },
  { value: 'updateTask', label: 'Tasks - Update task' },
  { value: 'getTask', label: 'Tasks - Get task' },
  { value: 'listTasks', label: 'Tasks - List tasks' },
  { value: 'deleteTask', label: 'Tasks - Delete task' },
  { value: 'searchTasks', label: 'Tasks - Search tasks' },
  { value: 'moveTask', label: 'Tasks - Move task to section' },
  { value: 'createSubtask', label: 'Subtasks - Create subtask' },
  { value: 'listSubtasks', label: 'Subtasks - List subtasks' },
  { value: 'addComment', label: 'Comments - Add comment to task' },
  { value: 'removeComment', label: 'Comments - Remove comment' },
  { value: 'addTaskProject', label: 'Projects - Add task to project' },
  { value: 'removeTaskProject', label: 'Projects - Remove task from project' },
  { value: 'addTaskTag', label: 'Tags - Add task tag' },
  { value: 'removeTaskTag', label: 'Tags - Remove task tag' },
  { value: 'getUser', label: 'Users - Get user' },
  { value: 'listUsers', label: 'Users - List users' }
]

const OPERATION_FIELDS: Record<AsanaOperation, OperationConfig> = {
  createProject: {
    label: 'Projects - Create project',
    required: ['workspaceGid', 'name'],
    optional: ['notes', 'teamGid', 'archived', 'additionalFields']
  },
  deleteProject: {
    label: 'Projects - Delete project',
    required: ['projectGid']
  },
  getProject: {
    label: 'Projects - Get project',
    required: ['projectGid']
  },
  listProjects: {
    label: 'Projects - List projects',
    required: ['workspaceGid'],
    optional: ['teamGid', 'limit']
  },
  updateProject: {
    label: 'Projects - Update project',
    required: ['projectGid'],
    optional: ['name', 'notes', 'archived', 'additionalFields']
  },
  createSubtask: {
    label: 'Subtasks - Create subtask',
    required: ['parentTaskGid', 'name'],
    optional: ['assignee', 'dueOn', 'dueAt', 'notes', 'additionalFields']
  },
  listSubtasks: {
    label: 'Subtasks - List subtasks',
    required: ['parentTaskGid'],
    optional: ['limit']
  },
  createTask: {
    label: 'Tasks - Create task',
    required: ['workspaceGid', 'name'],
    optional: [
      'projectGid',
      'assignee',
      'dueOn',
      'dueAt',
      'notes',
      'additionalFields'
    ]
  },
  deleteTask: {
    label: 'Tasks - Delete task',
    required: ['taskGid']
  },
  getTask: {
    label: 'Tasks - Get task',
    required: ['taskGid']
  },
  listTasks: {
    label: 'Tasks - List tasks',
    required: ['workspaceGid'],
    optional: ['projectGid', 'tagGid', 'assignee', 'limit']
  },
  moveTask: {
    label: 'Tasks - Move task to section',
    required: ['taskGid', 'sectionGid']
  },
  searchTasks: {
    label: 'Tasks - Search tasks',
    required: ['workspaceGid', 'query'],
    optional: ['projectGid', 'tagGid', 'assignee', 'completed', 'limit']
  },
  updateTask: {
    label: 'Tasks - Update task',
    required: ['taskGid'],
    optional: [
      'name',
      'notes',
      'assignee',
      'dueOn',
      'dueAt',
      'completed',
      'additionalFields'
    ]
  },
  addComment: {
    label: 'Comments - Add comment to task',
    required: ['taskGid', 'notes']
  },
  removeComment: {
    label: 'Comments - Remove comment',
    required: ['storyGid']
  },
  addTaskProject: {
    label: 'Projects - Add task to project',
    required: ['taskGid', 'projectGid'],
    optional: ['sectionGid']
  },
  removeTaskProject: {
    label: 'Projects - Remove task from project',
    required: ['taskGid', 'projectGid']
  },
  addTaskTag: {
    label: 'Tags - Add task tag',
    required: ['taskGid', 'tagGid']
  },
  removeTaskTag: {
    label: 'Tags - Remove task tag',
    required: ['taskGid', 'tagGid']
  },
  getUser: {
    label: 'Users - Get user',
    required: ['userGid']
  },
  listUsers: {
    label: 'Users - List users',
    required: ['workspaceGid'],
    optional: ['teamGid', 'limit']
  }
}

interface ValidationResult {
  hasErrors: boolean
  errors: Partial<Record<FieldKey | 'connection', string>>
}

interface AsanaActionProps {
  nodeId: string
  canEdit?: boolean
}

const normalizeScope = (value?: string | null): '' | AsanaConnectionScope => {
  const normalized = (value ?? '').trim().toLowerCase()
  if (
    normalized === 'workspace' ||
    normalized === 'personal' ||
    normalized === 'user'
  ) {
    return normalized === 'user'
      ? 'personal'
      : (normalized as AsanaConnectionScope)
  }
  return ''
}

const sanitizeKeyValues = (pairs: KeyValue[] | undefined): KeyValue[] => {
  if (!Array.isArray(pairs)) return []
  return pairs.map((pair) => ({
    key: typeof pair?.key === 'string' ? pair.key : `${pair?.key ?? ''}`,
    value: typeof pair?.value === 'string' ? pair.value : `${pair?.value ?? ''}`
  }))
}

const sanitizeAsanaParams = (
  params: Partial<AsanaActionParams> | null | undefined
): AsanaActionParams => {
  const base: AsanaActionParams = { ...DEFAULT_PARAMS }
  if (!params || typeof params !== 'object') {
    return base
  }

  const cleanString = (value: unknown): string =>
    typeof value === 'string' ? value : value != null ? String(value) : ''

  const operationRaw = cleanString(params.operation)
  const validOperation = OPERATION_OPTIONS.find(
    (option) => option.value === operationRaw
  )
  base.operation = validOperation
    ? validOperation.value
    : DEFAULT_PARAMS.operation

  const scope = normalizeScope(params.connectionScope)
  const connectionId = cleanString(params.connectionId)
  const connectionPayload =
    params.connection && typeof params.connection === 'object'
      ? (params.connection as AsanaConnectionSelection)
      : null

  const resolvedScope =
    normalizeScope(connectionPayload?.connectionScope) || scope || ''
  const resolvedId =
    cleanString(connectionPayload?.connectionId) || connectionId || ''
  const accountEmail = cleanString(connectionPayload?.accountEmail)

  base.connectionScope = resolvedScope
  base.connectionId = resolvedId
  base.connection =
    resolvedScope && resolvedId
      ? {
          connectionScope: resolvedScope as AsanaConnectionScope,
          connectionId: resolvedId,
          accountEmail: accountEmail || undefined
        }
      : undefined

  base.workspaceGid = cleanString(params.workspaceGid).trim()
  base.projectGid = cleanString(params.projectGid).trim()
  base.taskGid = cleanString(params.taskGid).trim()
  base.parentTaskGid = cleanString(params.parentTaskGid).trim()
  base.sectionGid = cleanString(params.sectionGid).trim()
  base.tagGid = cleanString(params.tagGid).trim()
  base.userGid = cleanString(params.userGid).trim()
  base.storyGid = cleanString(params.storyGid).trim()
  base.teamGid = cleanString(params.teamGid).trim()
  base.name = cleanString(params.name).trim()
  base.notes = cleanString(params.notes)
  base.dueOn = cleanString(params.dueOn).trim()
  base.dueAt = cleanString(params.dueAt).trim()
  base.assignee = cleanString(params.assignee).trim()
  base.query = cleanString(params.query)
  base.completed = Boolean(params.completed)
  base.archived = Boolean(params.archived)
  base.limit = cleanString(params.limit).trim()
  base.additionalFields = sanitizeKeyValues(params.additionalFields)
  base.hasValidationErrors = Boolean(params.hasValidationErrors)

  return base
}

const validateAsanaParams = (
  params: AsanaActionParams,
  hasAdditionalFieldErrors: boolean
): ValidationResult => {
  const errors: ValidationResult['errors'] = {}
  if (
    !params.connection ||
    !params.connection.connectionId ||
    !params.connection.connectionScope
  ) {
    errors.connection = 'Asana connection is required'
  }

  const config = OPERATION_FIELDS[params.operation]
  config.required.forEach((field) => {
    const value = params[field]
    if (
      field === 'completed' ||
      field === 'archived' ||
      field === 'additionalFields'
    ) {
      return
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors[field] = `${FIELD_META[field].label} is required`
    }
  })

  if (params.limit) {
    const parsed = Number(params.limit)
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.limit = 'Limit must be a positive number'
    }
  }

  if (hasAdditionalFieldErrors) {
    errors.additionalFields =
      'Additional fields must have unique keys and values'
  }

  return { hasErrors: Object.keys(errors).length > 0, errors }
}

const connectionValueKey = (scope: AsanaConnectionScope, id: string) =>
  `${scope}:${id}`

const emptyProviderState = (): ProviderConnectionSet => ({
  personal: {
    scope: 'personal',
    id: null,
    connected: false,
    requiresReconnect: false,
    isShared: false,
    accountEmail: undefined,
    expiresAt: undefined,
    lastRefreshedAt: undefined
  },
  workspace: []
})

const buildSelectionFromValue = (
  value?: AsanaActionParams['connection']
): AsanaConnectionSelection | null => {
  if (!value || typeof value !== 'object') return null
  const scope = normalizeScope(value.connectionScope)
  if (!scope) return null
  const id =
    typeof value.connectionId === 'string' ? value.connectionId.trim() : ''
  if (!id) return null
  const selection: AsanaConnectionSelection = {
    connectionScope: scope,
    connectionId: id
  }
  if (typeof value.accountEmail === 'string') {
    selection.accountEmail = value.accountEmail
  }
  return selection
}

const resolveConnectionSelection = (
  params: AsanaActionParams
): AsanaConnectionSelection | null => {
  const fromConnection = buildSelectionFromValue(params.connection)
  if (fromConnection) return fromConnection
  const scope = normalizeScope(params.connectionScope)
  const id =
    typeof params.connectionId === 'string' ? params.connectionId.trim() : ''
  if (!scope || !id) return null
  return { connectionScope: scope, connectionId: id }
}

export default function AsanaAction({
  nodeId,
  canEdit = true
}: AsanaActionProps) {
  const rawParams = useActionParams<Record<string, unknown>>(nodeId, 'asana')
  const asanaParams = useMemo(
    () => sanitizeAsanaParams(rawParams as AsanaActionParams),
    [rawParams]
  )

  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit

  const [additionalFieldErrors, setAdditionalFieldErrors] = useState(false)
  const validation = useMemo(
    () => validateAsanaParams(asanaParams, additionalFieldErrors),
    [asanaParams, additionalFieldErrors]
  )

  const applyAsanaPatch = useCallback(
    (patch: Partial<AsanaActionParams>) => {
      if (!effectiveCanEdit) return
      const next = sanitizeAsanaParams({ ...asanaParams, ...patch })
      const nextValidation = validateAsanaParams(next, additionalFieldErrors)
      if (deepEqual(asanaParams, next)) {
        if (next.hasValidationErrors !== nextValidation.hasErrors) {
          updateNodeData(nodeId, {
            hasValidationErrors: nextValidation.hasErrors
          })
        }
        return
      }
      updateNodeData(nodeId, {
        params: next,
        dirty: true,
        hasValidationErrors: nextValidation.hasErrors
      })
    },
    [
      additionalFieldErrors,
      asanaParams,
      effectiveCanEdit,
      nodeId,
      updateNodeData
    ]
  )

  useEffect(() => {
    if (asanaParams.hasValidationErrors !== validation.hasErrors) {
      updateNodeData(nodeId, { hasValidationErrors: validation.hasErrors })
    }
  }, [
    asanaParams.hasValidationErrors,
    nodeId,
    updateNodeData,
    validation.hasErrors
  ])

  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null

  const sanitizeConnections = useCallback(
    (connections: ProviderConnectionSet | null): ProviderConnectionSet => {
      if (!connections) return emptyProviderState()
      return {
        personal: connections.personal
          ? { ...connections.personal }
          : emptyProviderState().personal,
        workspace: Array.isArray(connections.workspace)
          ? connections.workspace.map((entry) => ({ ...entry }))
          : []
      }
    },
    []
  )

  const pickProviderConnections = useCallback(
    (
      snapshot: GroupedConnectionsSnapshot | null
    ): ProviderConnectionSet | null => {
      if (!snapshot) return null
      const personal = snapshot.personal.find((p) => p.provider === 'asana')
      const workspace = (snapshot.workspace ?? []).filter(
        (entry) => entry.provider === 'asana'
      )
      if (!personal && workspace.length === 0) {
        return null
      }
      return {
        personal: personal ?? {
          ...emptyProviderState().personal,
          scope: 'personal',
          connected: false,
          requiresReconnect: false
        },
        workspace
      }
    },
    []
  )

  const [connectionState, setConnectionState] =
    useState<ProviderConnectionSet | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const cached = getCachedConnections(workspaceId)
    const initial = pickProviderConnections(cached)
    if (active) {
      setConnectionState(sanitizeConnections(initial))
    }

    const unsubscribe = subscribeToConnectionUpdates(
      (snapshot) => {
        if (!active) return
        setConnectionState(
          sanitizeConnections(pickProviderConnections(snapshot))
        )
      },
      { workspaceId }
    )

    if (!initial && workspaceId) {
      setConnectionsLoading(true)
      fetchConnections({ workspaceId })
        .then((grouped) => {
          if (!active) return
          setConnectionState(
            sanitizeConnections(pickProviderConnections(grouped))
          )
          setConnectionsError(null)
        })
        .catch((err: unknown) => {
          if (!active) return
          const message =
            err instanceof Error
              ? err.message
              : 'Failed to load Asana connections'
          setConnectionsError(message)
        })
        .finally(() => active && setConnectionsLoading(false))
    }

    return () => {
      active = false
      unsubscribe()
    }
  }, [pickProviderConnections, sanitizeConnections, workspaceId])

  const activeConnection = useMemo(
    () => resolveConnectionSelection(asanaParams),
    [asanaParams]
  )

  const connectionOptions = useMemo<
    (NodeDropdownOption | NodeDropdownOptionGroup)[]
  >(() => {
    if (!connectionState) return []
    const options: (NodeDropdownOption | NodeDropdownOptionGroup)[] = []
    const personal = connectionState.personal
    if (personal && personal.connected && personal.id) {
      options.push({
        label: 'Personal connection',
        options: [
          {
            label: personal.accountEmail || 'Personal Asana account',
            value: connectionValueKey('personal', personal.id)
          }
        ]
      })
    }

    const workspaceEntries = connectionState.workspace ?? []
    if (workspaceEntries.length > 0) {
      options.push({
        label: 'Workspace connections',
        options: workspaceEntries.map((entry) => ({
          label:
            entry.workspaceName ||
            entry.accountEmail ||
            'Workspace Asana connection',
          value: connectionValueKey('workspace', entry.id!),
          disabled: Boolean(entry.requiresReconnect)
        }))
      })
    }

    return options
  }, [connectionState])

  const asanaConnectionOptions = useMemo<AsanaConnectionOptions | null>(() => {
    if (!activeConnection?.connectionId || !activeConnection.connectionScope) {
      return null
    }
    return {
      scope:
        activeConnection.connectionScope === 'workspace'
          ? 'workspace'
          : 'personal',
      connectionId: activeConnection.connectionId
    }
  }, [activeConnection])

  const [workspaceOptions, setWorkspaceOptions] = useState<
    NodeDropdownOption[]
  >([])
  const [workspaceOptionsLoading, setWorkspaceOptionsLoading] = useState(false)
  const [workspaceOptionsError, setWorkspaceOptionsError] = useState<
    string | null
  >(null)

  const [projectOptions, setProjectOptions] = useState<NodeDropdownOption[]>([])
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false)
  const [projectOptionsError, setProjectOptionsError] = useState<string | null>(
    null
  )

  const [tagOptions, setTagOptions] = useState<NodeDropdownOption[]>([])
  const [tagOptionsLoading, setTagOptionsLoading] = useState(false)
  const [tagOptionsError, setTagOptionsError] = useState<string | null>(null)

  const [teamOptions, setTeamOptions] = useState<NodeDropdownOption[]>([])
  const [teamOptionsLoading, setTeamOptionsLoading] = useState(false)
  const [teamOptionsError, setTeamOptionsError] = useState<string | null>(null)

  const [userOptions, setUserOptions] = useState<NodeDropdownOption[]>([])
  const [userOptionsLoading, setUserOptionsLoading] = useState(false)
  const [userOptionsError, setUserOptionsError] = useState<string | null>(null)

  const [sectionOptions, setSectionOptions] = useState<NodeDropdownOption[]>([])
  const [sectionOptionsLoading, setSectionOptionsLoading] = useState(false)
  const [sectionOptionsError, setSectionOptionsError] = useState<string | null>(
    null
  )

  const hasConnection = Boolean(asanaConnectionOptions)

  const todayIso = useMemo(() => {
    const now = new Date()
    return toISODateString(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  const [dueOnPickerOpen, setDueOnPickerOpen] = useState(false)
  const [dueOnMonth, setDueOnMonth] = useState<CalendarMonth>(() =>
    getInitialMonth(asanaParams.dueOn)
  )
  useEffect(() => {
    setDueOnMonth(getInitialMonth(asanaParams.dueOn))
  }, [asanaParams.dueOn])

  const defaultTimezone = useMemo(() => {
    try {
      return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }, [])
  const [dueAtTimezone, setDueAtTimezone] = useState(defaultTimezone)
  const [dueAtCalendarOpen, setDueAtCalendarOpen] = useState(false)
  const [dueAtTimeOpen, setDueAtTimeOpen] = useState(false)
  const [dueAtTimezoneOpen, setDueAtTimezoneOpen] = useState(false)
  const [dueAtTimezoneSearch, setDueAtTimezoneSearch] = useState('')
  const dueAtParts = useMemo(
    () => parseIsoDateTime(asanaParams.dueAt),
    [asanaParams.dueAt]
  )
  const [dueAtMonth, setDueAtMonth] = useState<CalendarMonth>(() =>
    getInitialMonth(dueAtParts.date)
  )
  useEffect(() => {
    setDueAtMonth(getInitialMonth(dueAtParts.date))
  }, [dueAtParts.date])

  const dueAtTimeString = useMemo(
    () =>
      dueAtParts.valid ? toTimeString(dueAtParts.hour, dueAtParts.minute) : '',
    [dueAtParts.hour, dueAtParts.minute, dueAtParts.valid]
  )
  const dueAtTimeParts = useMemo(
    () => parseTime(dueAtTimeString),
    [dueAtTimeString]
  )
  const timezoneOptions = useMemo(() => {
    const options: string[] = []
    try {
      const maybeSupported = (Intl as any).supportedValuesOf
      if (typeof maybeSupported === 'function') {
        const supported = maybeSupported('timeZone')
        if (Array.isArray(supported)) {
          options.push(...supported)
        }
      }
    } catch {
      /* ignore */
    }
    options.push(dueAtTimezone, 'UTC')
    return Array.from(new Set(options))
  }, [dueAtTimezone])
  const filteredTimezones = useMemo(() => {
    const needle = dueAtTimezoneSearch.trim().toLowerCase()
    if (!needle) return timezoneOptions
    return timezoneOptions.filter((tz) => tz.toLowerCase().includes(needle))
  }, [dueAtTimezoneSearch, timezoneOptions])
  const updateDueAt = useCallback(
    (
      dateStr: string,
      hour: number,
      minute: number,
      second?: number,
      tz?: string
    ) => {
      const iso = buildIsoDateTime(
        dateStr,
        hour,
        minute,
        second ?? 0,
        tz || dueAtTimezone
      )
      applyAsanaPatch({ dueAt: iso ?? '' })
    },
    [applyAsanaPatch, dueAtTimezone]
  )
  const handleDueAtTimezoneSelect = useCallback(
    (tz: string) => {
      setDueAtTimezone(tz)
      if (dueAtParts.date) {
        updateDueAt(
          dueAtParts.date,
          dueAtParts.hour,
          dueAtParts.minute,
          dueAtParts.second,
          tz
        )
      }
    },
    [
      dueAtParts.date,
      dueAtParts.hour,
      dueAtParts.minute,
      dueAtParts.second,
      updateDueAt
    ]
  )

  const handleWorkspaceSelect = useCallback(
    (workspaceGid: string) => {
      applyAsanaPatch({
        workspaceGid,
        projectGid: '',
        sectionGid: '',
        tagGid: '',
        teamGid: '',
        userGid: ''
      })
    },
    [applyAsanaPatch]
  )

  const handleProjectSelect = useCallback(
    (projectGid: string) => {
      applyAsanaPatch({
        projectGid,
        sectionGid: ''
      })
    },
    [applyAsanaPatch]
  )

  const handleTagSelect = useCallback(
    (tagGid: string) => {
      applyAsanaPatch({ tagGid })
    },
    [applyAsanaPatch]
  )

  const handleTeamSelect = useCallback(
    (teamGid: string) => {
      applyAsanaPatch({
        teamGid,
        userGid: ''
      })
    },
    [applyAsanaPatch]
  )

  const handleUserSelect = useCallback(
    (userGid: string) => {
      applyAsanaPatch({ userGid })
    },
    [applyAsanaPatch]
  )

  const handleSectionSelect = useCallback(
    (sectionGid: string) => {
      applyAsanaPatch({ sectionGid })
    },
    [applyAsanaPatch]
  )

  useEffect(() => {
    setWorkspaceOptions([])
    setWorkspaceOptionsError(null)
    if (!asanaConnectionOptions) {
      setWorkspaceOptionsLoading(false)
      return
    }

    let cancelled = false
    setWorkspaceOptionsLoading(true)
    fetchAsanaWorkspaces(asanaConnectionOptions)
      .then((workspaces: AsanaWorkspace[]) => {
        if (cancelled) return
        const options = workspaces.map((workspace) => ({
          value: workspace.gid,
          label: workspace.name || workspace.gid
        }))
        setWorkspaceOptions(options)
        setWorkspaceOptionsError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setWorkspaceOptionsError(
          err instanceof Error
            ? err.message
            : 'Failed to load Asana workspaces for this connection'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceOptionsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [asanaConnectionOptions])

  useEffect(() => {
    setProjectOptions([])
    setTagOptions([])
    setTeamOptions([])
    setUserOptions([])
    setSectionOptions([])
    setProjectOptionsError(null)
    setTagOptionsError(null)
    setTeamOptionsError(null)
    setUserOptionsError(null)

    const workspaceGid = asanaParams.workspaceGid?.trim()
    if (!workspaceGid || !asanaConnectionOptions) {
      setProjectOptionsLoading(false)
      setTagOptionsLoading(false)
      setTeamOptionsLoading(false)
      setUserOptionsLoading(false)
      return
    }

    let cancelled = false
    setProjectOptionsLoading(true)
    setTagOptionsLoading(true)
    setTeamOptionsLoading(true)
    setUserOptionsLoading(true)

    Promise.allSettled([
      fetchAsanaProjects(workspaceGid, asanaConnectionOptions),
      fetchAsanaTags(workspaceGid, asanaConnectionOptions),
      fetchAsanaTeams(workspaceGid, asanaConnectionOptions),
      fetchAsanaUsers(
        workspaceGid,
        asanaConnectionOptions,
        asanaParams.teamGid?.trim() || undefined
      )
    ]).then((results) => {
      if (cancelled) return

      const [projects, tags, teams, users] = results

      if (projects.status === 'fulfilled') {
        setProjectOptions(
          projects.value.map((project: AsanaProject) => ({
            value: project.gid,
            label: project.name || project.gid
          }))
        )
        setProjectOptionsError(null)
      } else {
        setProjectOptionsError(
          projects.reason instanceof Error
            ? projects.reason.message
            : 'Failed to load Asana projects'
        )
      }

      if (tags.status === 'fulfilled') {
        setTagOptions(
          tags.value.map((tag: AsanaTag) => ({
            value: tag.gid,
            label: tag.name || tag.gid
          }))
        )
        setTagOptionsError(null)
      } else {
        setTagOptionsError(
          tags.reason instanceof Error
            ? tags.reason.message
            : 'Failed to load Asana tags'
        )
      }

      if (teams.status === 'fulfilled') {
        setTeamOptions(
          teams.value.map((team: AsanaTeam) => ({
            value: team.gid,
            label: team.name || team.gid
          }))
        )
        setTeamOptionsError(null)
      } else {
        setTeamOptionsError(
          teams.reason instanceof Error
            ? teams.reason.message
            : 'Failed to load Asana teams'
        )
      }

      if (users.status === 'fulfilled') {
        setUserOptions(
          users.value.map((user: AsanaUser) => ({
            value: user.gid,
            label: user.email
              ? `${user.name || user.gid} (${user.email})`
              : user.name || user.gid
          }))
        )
        setUserOptionsError(null)
      } else {
        setUserOptionsError(
          users.reason instanceof Error
            ? users.reason.message
            : 'Failed to load Asana users'
        )
      }

      setProjectOptionsLoading(false)
      setTagOptionsLoading(false)
      setTeamOptionsLoading(false)
      setUserOptionsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [
    asanaConnectionOptions,
    asanaParams.workspaceGid,
    asanaParams.teamGid,
    asanaParams.connectionId,
    asanaParams.connectionScope
  ])

  useEffect(() => {
    setSectionOptions([])
    setSectionOptionsError(null)
    const projectGid = asanaParams.projectGid?.trim()
    if (!projectGid || !asanaConnectionOptions) {
      setSectionOptionsLoading(false)
      return
    }

    let cancelled = false
    setSectionOptionsLoading(true)
    fetchAsanaSections(projectGid, asanaConnectionOptions)
      .then((sections: AsanaSection[]) => {
        if (cancelled) return
        setSectionOptions(
          sections.map((section) => ({
            value: section.gid,
            label: section.name || section.gid
          }))
        )
        setSectionOptionsError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setSectionOptionsError(
          err instanceof Error
            ? err.message
            : 'Failed to load Asana sections for this project'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setSectionOptionsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [asanaConnectionOptions, asanaParams.projectGid])

  const selectedConnectionValue = useMemo(() => {
    if (!activeConnection?.connectionId || !activeConnection.connectionScope)
      return ''
    return connectionValueKey(
      activeConnection.connectionScope as AsanaConnectionScope,
      activeConnection.connectionId
    )
  }, [activeConnection])

  const hasOAuthConnections =
    Boolean(
      connectionState?.personal?.connected && connectionState.personal.id
    ) || (connectionState?.workspace?.length ?? 0) > 0

  const handleConnectionChange = useCallback(
    (value: string) => {
      if (!value || typeof value !== 'string') return
      const [scopeRaw, idRaw] = value.split(':')
      const scope = normalizeScope(scopeRaw)
      const id = (idRaw ?? '').trim()
      if (!scope || !id) {
        applyAsanaPatch({
          connectionScope: '',
          connectionId: '',
          connection: undefined
        })
        return
      }
      const nextSelection: AsanaConnectionSelection = {
        connectionScope: scope as AsanaConnectionScope,
        connectionId: id
      }
      const workspaceEntry = connectionState?.workspace.find(
        (entry) => entry.id === id
      )
      const personalEntry =
        connectionState?.personal?.id === id ? connectionState.personal : null
      const accountEmail =
        workspaceEntry?.accountEmail ||
        personalEntry?.accountEmail ||
        workspaceEntry?.sharedByEmail
      if (accountEmail) {
        nextSelection.accountEmail = accountEmail
      }
      applyAsanaPatch({
        connectionScope: scope,
        connectionId: id,
        connection: nextSelection
      })
    },
    [applyAsanaPatch, connectionState]
  )

  const visibleFields = useMemo(() => {
    const config = OPERATION_FIELDS[asanaParams.operation]
    return {
      required: config.required,
      optional: config.optional ?? []
    }
  }, [asanaParams.operation])

  const renderField = (field: FieldKey, isRequired: boolean) => {
    const meta = FIELD_META[field]
    const value = (asanaParams as Record<string, unknown>)[field]
    const error = validation.errors[field]
    const labelText = `${meta.label}${isRequired ? ' *' : ''}`

    if (field === 'workspaceGid') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={workspaceOptions}
            value={currentValue}
            onChange={handleWorkspaceSelect}
            placeholder={
              !hasConnection
                ? 'Connect Asana to load workspaces'
                : workspaceOptionsLoading
                  ? 'Loading workspaces...'
                  : 'Select workspace'
            }
            disabled={
              !effectiveCanEdit || !hasConnection || workspaceOptionsLoading
            }
            loading={workspaceOptionsLoading}
            emptyMessage={
              workspaceOptionsError ||
              'No Asana workspaces available for this connection'
            }
          />
          {workspaceOptionsError && (
            <p className="text-xs text-red-500">{workspaceOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'projectGid') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={projectOptions}
            value={currentValue}
            onChange={handleProjectSelect}
            placeholder={
              !hasConnection
                ? 'Select an Asana connection first'
                : asanaParams.workspaceGid
                  ? projectOptionsLoading
                    ? 'Loading projects...'
                    : 'Select project'
                  : 'Select a workspace first'
            }
            disabled={
              !effectiveCanEdit || !hasConnection || projectOptionsLoading
            }
            loading={projectOptionsLoading}
            emptyMessage={projectOptionsError || 'No projects available'}
          />
          {projectOptionsError && (
            <p className="text-xs text-red-500">{projectOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'sectionGid') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={sectionOptions}
            value={currentValue}
            onChange={handleSectionSelect}
            placeholder={
              !hasConnection
                ? 'Select an Asana connection first'
                : asanaParams.projectGid
                  ? sectionOptionsLoading
                    ? 'Loading sections...'
                    : 'Select section'
                  : 'Select a project first'
            }
            disabled={
              !effectiveCanEdit || !hasConnection || sectionOptionsLoading
            }
            loading={sectionOptionsLoading}
            emptyMessage={sectionOptionsError || 'No sections available'}
          />
          {sectionOptionsError && (
            <p className="text-xs text-red-500">{sectionOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'tagGid') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={tagOptions}
            value={currentValue}
            onChange={handleTagSelect}
            placeholder={
              !hasConnection
                ? 'Select an Asana connection first'
                : asanaParams.workspaceGid
                  ? tagOptionsLoading
                    ? 'Loading tags...'
                    : 'Select tag'
                  : 'Select a workspace first'
            }
            disabled={!effectiveCanEdit || !hasConnection || tagOptionsLoading}
            loading={tagOptionsLoading}
            emptyMessage={tagOptionsError || 'No tags available'}
          />
          {tagOptionsError && (
            <p className="text-xs text-red-500">{tagOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'teamGid') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={teamOptions}
            value={currentValue}
            onChange={handleTeamSelect}
            placeholder={
              !hasConnection
                ? 'Select an Asana connection first'
                : asanaParams.workspaceGid
                  ? teamOptionsLoading
                    ? 'Loading teams...'
                    : 'Select team (optional)'
                  : 'Select a workspace first'
            }
            disabled={!effectiveCanEdit || !hasConnection || teamOptionsLoading}
            loading={teamOptionsLoading}
            emptyMessage={teamOptionsError || 'No teams available'}
          />
          {teamOptionsError && (
            <p className="text-xs text-red-500">{teamOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'assignee') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={userOptions}
            value={currentValue}
            onChange={(gid) => applyAsanaPatch({ assignee: gid })}
            placeholder={
              !hasConnection
                ? 'Select an Asana connection first'
                : asanaParams.workspaceGid
                  ? userOptionsLoading
                    ? 'Loading users...'
                    : 'Select assignee'
                  : 'Select a workspace first'
            }
            disabled={!effectiveCanEdit || !hasConnection || userOptionsLoading}
            loading={userOptionsLoading}
            emptyMessage={userOptionsError || 'No users available'}
          />
          {userOptionsError && (
            <p className="text-xs text-red-500">{userOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'userGid') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={userOptions}
            value={currentValue}
            onChange={handleUserSelect}
            placeholder={
              !hasConnection
                ? 'Select an Asana connection first'
                : asanaParams.workspaceGid
                  ? userOptionsLoading
                    ? 'Loading users...'
                    : 'Select user'
                  : 'Select a workspace first'
            }
            disabled={!effectiveCanEdit || !hasConnection || userOptionsLoading}
            loading={userOptionsLoading}
            emptyMessage={userOptionsError || 'No users available'}
          />
          {userOptionsError && (
            <p className="text-xs text-red-500">{userOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'dueOn') {
      const dateValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <div className="relative">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
              onClick={() => setDueOnPickerOpen((open) => !open)}
              disabled={!effectiveCanEdit}
            >
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-zinc-400 dark:text-zinc-300" />
                {dateValue ? formatDisplayDate(dateValue) : 'Select date'}
              </span>
            </button>
            {dueOnPickerOpen ? (
              <div className="absolute z-30 mt-2">
                <ScheduleCalendar
                  month={dueOnMonth}
                  selectedDate={dateValue}
                  todayISO={todayIso}
                  onMonthChange={(month) => setDueOnMonth(month)}
                  onSelectDate={(isoDate) => {
                    setDueOnPickerOpen(false)
                    setDueOnMonth(getInitialMonth(isoDate))
                    applyAsanaPatch({ dueOn: isoDate })
                  }}
                />
              </div>
            ) : null}
          </div>
          <NodeInputField
            placeholder="Or enter date (YYYY-MM-DD)"
            value={dateValue}
            onChange={(val) => applyAsanaPatch({ dueOn: val })}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'dueAt') {
      return (
        <div key={field} className="space-y-2">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                onClick={() => {
                  setDueAtCalendarOpen((open) => !open)
                  setDueAtTimeOpen(false)
                  setDueAtTimezoneOpen(false)
                }}
                disabled={!effectiveCanEdit}
              >
                <span className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-zinc-400 dark:text-zinc-300" />
                  {dueAtParts.valid
                    ? formatDisplayDate(dueAtParts.date)
                    : 'Select date'}
                </span>
              </button>
              {dueAtCalendarOpen ? (
                <div className="absolute z-30 mt-2">
                  <ScheduleCalendar
                    month={dueAtMonth}
                    selectedDate={dueAtParts.date}
                    todayISO={todayIso}
                    onMonthChange={(month) => setDueAtMonth(month)}
                    onSelectDate={(isoDate) => {
                      setDueAtCalendarOpen(false)
                      setDueAtMonth(getInitialMonth(isoDate))
                      updateDueAt(
                        isoDate,
                        dueAtParts.hour,
                        dueAtParts.minute,
                        dueAtParts.second
                      )
                    }}
                  />
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                onClick={() => {
                  setDueAtTimeOpen((open) => !open)
                  setDueAtCalendarOpen(false)
                  setDueAtTimezoneOpen(false)
                }}
                disabled={!effectiveCanEdit}
              >
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-zinc-400 dark:text-zinc-300" />
                  {dueAtParts.valid
                    ? formatDisplayTime(dueAtTimeString)
                    : 'Select time'}
                </span>
              </button>
              {dueAtTimeOpen ? (
                <div className="absolute z-30 mt-2">
                  <ScheduleTimePicker
                    selectedTime={dueAtTimeParts}
                    onSelect={(time) => {
                      const parsed = parseTime(time)
                      const nextHour = parsed?.hours ?? 0
                      const nextMinute = parsed?.minutes ?? 0
                      setDueAtTimeOpen(false)
                      updateDueAt(
                        dueAtParts.date,
                        nextHour,
                        nextMinute,
                        dueAtParts.second
                      )
                    }}
                    onClose={() => setDueAtTimeOpen(false)}
                  />
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                onClick={() => {
                  setDueAtTimezoneOpen((open) => !open)
                  setDueAtCalendarOpen(false)
                  setDueAtTimeOpen(false)
                }}
                disabled={!effectiveCanEdit}
              >
                <span className="flex items-center gap-2">
                  <Globe2 className="h-4 w-4 text-zinc-400 dark:text-zinc-300" />
                  {dueAtTimezone || 'Select timezone'}
                </span>
              </button>
              {dueAtTimezoneOpen ? (
                <div className="absolute z-30 mt-2">
                  <ScheduleTimezonePicker
                    options={filteredTimezones}
                    selectedTimezone={dueAtTimezone}
                    search={dueAtTimezoneSearch}
                    onSearchChange={(value) => setDueAtTimezoneSearch(value)}
                    onSelect={(tz) => {
                      setDueAtTimezoneOpen(false)
                      setDueAtTimezoneSearch('')
                      handleDueAtTimezoneSelect(tz)
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <NodeInputField
            placeholder="Or enter ISO datetime"
            value={typeof value === 'string' ? value : ''}
            onChange={(val) => applyAsanaPatch({ dueAt: val })}
          />
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Date/time is captured in UTC and saved as ISO 8601. Timezone
            selection converts to UTC.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'completed' || field === 'archived') {
      return (
        <NodeCheckBoxField
          key={field}
          checked={Boolean(value)}
          onChange={(checked) => applyAsanaPatch({ [field]: checked } as any)}
        >
          {labelText}
        </NodeCheckBoxField>
      )
    }

    if (field === 'notes' || meta.kind === 'textarea') {
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeTextAreaField
            value={typeof value === 'string' ? value : ''}
            placeholder={meta.placeholder}
            onChange={(val) => applyAsanaPatch({ [field]: val } as any)}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'additionalFields') {
      return (
        <div key={field} className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {meta.label}
            </p>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {meta.helper}
            </span>
          </div>
          <KeyValuePair
            variables={asanaParams.additionalFields ?? []}
            placeholderKey="field name"
            placeholderValue="value"
            onChange={(pairs, hasErrors) => {
              setAdditionalFieldErrors(hasErrors)
              applyAsanaPatch({ additionalFields: pairs })
            }}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    return (
      <div key={field} className="space-y-1">
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          {labelText}
        </p>
        <NodeInputField
          type={meta.kind === 'number' ? 'number' : 'text'}
          value={typeof value === 'string' ? value : ''}
          placeholder={meta.placeholder}
          onChange={(val) => applyAsanaPatch({ [field]: val } as any)}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          Asana connection
        </p>
        <NodeDropdownField
          options={connectionOptions}
          value={selectedConnectionValue}
          onChange={handleConnectionChange}
          placeholder="Select Asana connection"
          disabled={!effectiveCanEdit}
          loading={connectionsLoading}
          emptyMessage="No Asana connections available"
        />
        {connectionsError && (
          <p className="text-xs text-red-500">{connectionsError}</p>
        )}
        {!connectionsLoading && !connectionsError && !hasOAuthConnections && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {'Connect Asana under Settings -> Integrations to use this action.'}
          </p>
        )}
        {validation.errors.connection && (
          <p className="text-xs text-red-500">{validation.errors.connection}</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          Operation
        </p>
        <NodeDropdownField
          options={OPERATION_OPTIONS.map<NodeDropdownOption>((option) => ({
            label: option.label,
            value: option.value
          }))}
          value={asanaParams.operation}
          onChange={(val) =>
            applyAsanaPatch({ operation: val as AsanaOperation })
          }
          disabled={!effectiveCanEdit}
        />
      </div>

      <div className="space-y-3">
        {visibleFields.required.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Required fields
            </p>
            <div className="space-y-2">
              {visibleFields.required.map((field) => renderField(field, true))}
            </div>
          </div>
        )}

        {visibleFields.optional.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Optional fields
            </p>
            <div className="space-y-2">
              {visibleFields.optional.map((field) => renderField(field, false))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

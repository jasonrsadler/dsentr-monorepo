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
  fetchAsanaStories,
  fetchAsanaTags,
  fetchAsanaTasks,
  fetchAsanaTeams,
  fetchAsanaUsers,
  fetchAsanaWorkspaces,
  type AsanaConnectionOptions,
  type AsanaProject,
  type AsanaSection,
  type AsanaStory,
  type AsanaTag,
  type AsanaTask,
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
import { normalizePlanTier } from '@/lib/planTiers'
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
import { errorMessage } from '@/lib/errorMessage'

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
  projectSelection?: string
  taskGid?: string
  taskSelection?: string
  parentTaskGid?: string
  parentTaskSelection?: string
  sectionGid?: string
  tagGid?: string
  tagSelection?: string
  userGid?: string
  storyGid?: string
  storySelection?: string
  teamGid?: string
  name?: string
  notes?: string
  dueOn?: string
  dueAt?: string
  assignee?: string
  assigneeSelection?: string
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
  projectSelection: '',
  taskGid: '',
  taskSelection: '',
  parentTaskGid: '',
  parentTaskSelection: '',
  sectionGid: '',
  tagGid: '',
  tagSelection: '',
  userGid: '',
  storyGid: '',
  storySelection: '',
  teamGid: '',
  name: '',
  notes: '',
  dueOn: '',
  dueAt: '',
  assignee: '',
  assigneeSelection: '',
  query: '',
  completed: false,
  archived: false,
  limit: '',
  additionalFields: [],
  hasValidationErrors: false
}

const NO_PROJECT_OPTION: NodeDropdownOption = {
  label: 'No Project',
  value: ''
}

const NO_TAG_OPTION: NodeDropdownOption = {
  label: 'No Tag',
  value: ''
}

const NO_ASSIGNEE_OPTION: NodeDropdownOption = {
  label: 'No Assignee',
  value: ''
}

const MANUAL_OPTION_VALUE = '__manual__'
const MANUAL_OPTION: NodeDropdownOption = {
  label: 'Manual',
  value: MANUAL_OPTION_VALUE
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
    label: 'Workspace',
    placeholder: 'Select workspace'
  },
  projectGid: {
    label: 'Project',
    placeholder: 'Project'
  },
  taskGid: {
    label: 'Task',
    placeholder: 'Task'
  },
  parentTaskGid: {
    label: 'Parent Task',
    placeholder: 'Parent task to attach a subtask'
  },
  sectionGid: {
    label: 'Section',
    placeholder: 'Target section/column'
  },
  tagGid: {
    label: 'Tag',
    placeholder: 'Tag'
  },
  userGid: {
    label: 'User',
    placeholder: 'User'
  },
  storyGid: {
    label: 'Comment',
    placeholder: 'Comment'
  },
  teamGid: {
    label: 'Team',
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
    label: 'Assignee',
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
    optional: ['notes', 'teamGid', 'additionalFields']
  },
  deleteProject: {
    label: 'Projects - Delete project',
    required: ['workspaceGid', 'projectGid']
  },
  getProject: {
    label: 'Projects - Get project',
    required: ['workspaceGid', 'projectGid']
  },
  listProjects: {
    label: 'Projects - List projects',
    required: ['workspaceGid'],
    optional: ['teamGid', 'limit']
  },
  updateProject: {
    label: 'Projects - Update project',
    required: ['workspaceGid', 'projectGid'],
    optional: ['name', 'notes', 'additionalFields']
  },
  createSubtask: {
    label: 'Subtasks - Create subtask',
    required: ['workspaceGid', 'parentTaskGid', 'name'],
    optional: [
      'projectGid',
      'assignee',
      'dueOn',
      'dueAt',
      'notes',
      'additionalFields'
    ]
  },
  listSubtasks: {
    label: 'Subtasks - List subtasks',
    required: ['workspaceGid', 'parentTaskGid'],
    optional: ['projectGid', 'limit']
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
    required: ['workspaceGid', 'taskGid'],
    optional: ['projectGid']
  },
  getTask: {
    label: 'Tasks - Get task',
    required: ['workspaceGid', 'taskGid'],
    optional: ['projectGid']
  },
  listTasks: {
    label: 'Tasks - List tasks',
    required: ['workspaceGid'],
    optional: ['projectGid', 'tagGid', 'assignee', 'limit']
  },
  moveTask: {
    label: 'Tasks - Move task to section',
    required: ['workspaceGid', 'taskGid', 'sectionGid'],
    optional: ['projectGid']
  },
  searchTasks: {
    label: 'Tasks - Search tasks',
    required: ['workspaceGid', 'query'],
    optional: ['projectGid', 'tagGid', 'assignee', 'completed', 'limit']
  },
  updateTask: {
    label: 'Tasks - Update task',
    required: ['workspaceGid', 'taskGid', 'name'],
    optional: [
      'projectGid',
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
    required: ['workspaceGid', 'taskGid', 'notes'],
    optional: ['projectGid']
  },
  removeComment: {
    label: 'Comments - Remove comment',
    required: ['workspaceGid', 'taskGid', 'storyGid'],
    optional: ['projectGid']
  },
  addTaskProject: {
    label: 'Projects - Add task to project',
    required: ['workspaceGid', 'taskGid', 'projectGid']
  },
  removeTaskProject: {
    label: 'Projects - Remove task from project',
    required: ['workspaceGid', 'taskGid', 'projectGid']
  },
  addTaskTag: {
    label: 'Tags - Add task tag',
    required: ['workspaceGid', 'taskGid', 'tagGid']
  },
  removeTaskTag: {
    label: 'Tags - Remove task tag',
    required: ['workspaceGid', 'taskGid', 'tagGid']
  },
  getUser: {
    label: 'Users - Get user',
    required: ['workspaceGid', 'userGid']
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
  planTier?: string | null
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

  // Operation --------------------------------------
  if (params.operation !== undefined) {
    const raw = cleanString(params.operation)
    const valid = OPERATION_OPTIONS.find((o) => o.value === raw)
    base.operation = valid ? valid.value : DEFAULT_PARAMS.operation
  }

  // Connection -------------------------------------
  if (params.connectionScope !== undefined) {
    base.connectionScope = normalizeScope(params.connectionScope)
  }

  if (params.connectionId !== undefined) {
    base.connectionId = cleanString(params.connectionId)
  }

  if (
    params.connection !== undefined &&
    typeof params.connection === 'object'
  ) {
    const c = params.connection as AsanaConnectionSelection
    const scope = normalizeScope(c.connectionScope)
    const id = cleanString(c.connectionId)
    const email = cleanString(c.accountEmail)

    if (scope && id) {
      base.connection = {
        connectionScope: scope as AsanaConnectionScope,
        connectionId: id,
        accountEmail: email || undefined
      }
      base.connectionScope = scope
      base.connectionId = id
    }
  }

  // Simple string fields ----------------------------
  const stringFields: (keyof AsanaActionParams)[] = [
    'workspaceGid',
    'projectGid',
    'projectSelection',
    'taskGid',
    'taskSelection',
    'parentTaskGid',
    'parentTaskSelection',
    'sectionGid',
    'tagGid',
    'tagSelection',
    'userGid',
    'storyGid',
    'storySelection',
    'teamGid',
    'name',
    'notes',
    'dueOn',
    'dueAt',
    'assignee',
    'assigneeSelection',
    'query',
    'limit'
  ]

  for (const key of stringFields) {
    if (params[key] !== undefined) {
      base[key] = cleanString(params[key]).trim()
    }
  }

  if (!base.projectSelection && base.projectGid) {
    base.projectSelection = base.projectGid
  }
  if (!base.taskSelection && base.taskGid) {
    base.taskSelection = base.taskGid
  }
  if (!base.parentTaskSelection && base.parentTaskGid) {
    base.parentTaskSelection = base.parentTaskGid
  }
  if (!base.tagSelection && base.tagGid) {
    base.tagSelection = base.tagGid
  }
  if (!base.storySelection && base.storyGid) {
    base.storySelection = base.storyGid
  }
  if (!base.assigneeSelection && base.assignee) {
    base.assigneeSelection = base.assignee
  }

  // Booleans ----------------------------------------
  if (params.completed !== undefined) {
    base.completed = Boolean(params.completed)
  }

  if (params.archived !== undefined) {
    base.archived = Boolean(params.archived)
  }

  // Additional fields -------------------------------
  if (params.additionalFields !== undefined) {
    base.additionalFields = sanitizeKeyValues(params.additionalFields)
  }

  if (params.hasValidationErrors !== undefined) {
    base.hasValidationErrors = Boolean(params.hasValidationErrors)
  }

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

  // Asana list tasks requires either project or tag, or assignee + workspace.
  if (params.operation === 'listTasks') {
    const hasProject = Boolean(params.projectGid?.trim())
    const hasTag = Boolean(params.tagGid?.trim())
    const hasAssignee = Boolean(params.assignee?.trim())
    const selectedCount = [hasProject, hasTag, hasAssignee].filter(
      Boolean
    ).length

    if (selectedCount === 0) {
      const message =
        'Provide exactly one filter: project, tag, or assignee (with workspace) to list tasks'
      errors.projectGid = message
      errors.tagGid = message
      errors.assignee = message
    } else if (selectedCount > 1) {
      const message =
        'Choose only one of project, tag, or assignee for list tasks'
      errors.projectGid = message
      errors.tagGid = message
      errors.assignee = message
    } else if (hasAssignee && !params.workspaceGid?.trim()) {
      errors.assignee = 'Assignee requires workspace for list tasks'
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
  canEdit = true,
  planTier
}: AsanaActionProps) {
  const rawParams = useActionParams<Record<string, unknown>>(nodeId, 'asana')
  const asanaParams = useMemo(
    () => sanitizeAsanaParams(rawParams as AsanaActionParams),
    [rawParams]
  )

  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit

  const [selectedTaskDetails, setSelectedTaskDetails] =
    useState<AsanaTask | null>(null)

  const [additionalFieldErrors, setAdditionalFieldErrors] = useState(false)
  const [taskDetailsMap, setTaskDetailsMap] = useState<Map<string, AsanaTask>>(
    new Map()
  )

  const validation = useMemo(
    () => validateAsanaParams(asanaParams, additionalFieldErrors),
    [asanaParams, additionalFieldErrors]
  )

  const buildTaskPrefillFromDetails = useCallback(
    (task: AsanaTask | null | undefined): Partial<AsanaActionParams> => {
      if (!task) return {}

      return {
        name: task.name ?? '',
        notes: task.notes ?? '',
        completed: task.completed ?? false,
        assignee: task.assignee?.gid ?? '',
        dueOn: task.due_on ?? '',
        dueAt: task.due_at ?? '',
        additionalFields:
          task.custom_fields?.map((cf) => {
            const key = cf.name ?? cf.gid
            let value = ''
            if (cf.text_value != null) value = cf.text_value
            else if (cf.number_value != null) value = String(cf.number_value)
            else if (cf.enum_value?.name != null) value = cf.enum_value.name
            return { key, value }
          }) ?? []
      }
    },
    []
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

  const handleOperationChange = useCallback(
    (op: string) => {
      if (!effectiveCanEdit) return
      const operation = (op as AsanaOperation) || DEFAULT_PARAMS.operation
      if (operation === 'updateTask') {
        // Reset fields so only workspace picker is available
        const reset: Partial<AsanaActionParams> = {
          operation,
          // clear workspace so user re-selects it (shows only workspace picker)
          workspaceGid: '',
          projectGid: '',
          projectSelection: '',
          taskGid: '',
          taskSelection: '',
          parentTaskSelection: '',
          name: '',
          assignee: '',
          assigneeSelection: '',
          notes: '',
          dueOn: '',
          dueAt: '',
          additionalFields: [],
          completed: false,
          archived: false,
          limit: ''
        }
        applyAsanaPatch(reset)
        return
      }
      applyAsanaPatch({ operation })
    },
    [applyAsanaPatch, effectiveCanEdit]
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
  const normalizedPlanTierValue = normalizePlanTier(
    planTier ?? currentWorkspace?.workspace.plan ?? null
  )
  const isSoloPlan = normalizedPlanTierValue === 'solo'

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
  }, [activeConnection?.connectionScope, activeConnection?.connectionId])

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
  const projectDropdownOptions = useMemo<NodeDropdownOption[]>(() => {
    const allowNoProject =
      asanaParams.operation === 'createTask' ||
      asanaParams.operation === 'updateTask' ||
      asanaParams.operation === 'deleteTask' ||
      asanaParams.operation === 'listTasks'
    return allowNoProject
      ? [NO_PROJECT_OPTION, MANUAL_OPTION, ...projectOptions]
      : [MANUAL_OPTION, ...projectOptions]
  }, [asanaParams.operation, projectOptions])

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

  const [taskOptions, setTaskOptions] = useState<NodeDropdownOption[]>([])
  const [taskOptionsLoading, setTaskOptionsLoading] = useState(false)
  const [taskOptionsError, setTaskOptionsError] = useState<string | null>(null)

  const [commentOptions, setCommentOptions] = useState<NodeDropdownOption[]>([])
  const [commentOptionsLoading, setCommentOptionsLoading] = useState(false)
  const [commentOptionsError, setCommentOptionsError] = useState<string | null>(
    null
  )

  const hasConnection = Boolean(asanaConnectionOptions)

  const [debouncedWorkspaceGid, setDebouncedWorkspaceGid] = useState(
    asanaParams.workspaceGid?.trim() ?? ''
  )
  const [debouncedProjectGid, setDebouncedProjectGid] = useState(
    asanaParams.projectGid?.trim() ?? ''
  )
  const [debouncedTeamGid, setDebouncedTeamGid] = useState(
    asanaParams.teamGid?.trim() ?? ''
  )

  useEffect(() => {
    const next = (asanaParams.workspaceGid ?? '').trim()
    if (next === debouncedWorkspaceGid) return
    const id = window.setTimeout(() => setDebouncedWorkspaceGid(next), 300)
    return () => window.clearTimeout(id)
  }, [asanaParams.workspaceGid, debouncedWorkspaceGid])

  useEffect(() => {
    const next = (asanaParams.projectGid ?? '').trim()
    if (next === debouncedProjectGid) return
    const id = window.setTimeout(() => setDebouncedProjectGid(next), 300)
    return () => window.clearTimeout(id)
  }, [asanaParams.projectGid, debouncedProjectGid])

  useEffect(() => {
    const next = (asanaParams.teamGid ?? '').trim()
    if (next === debouncedTeamGid) return
    const id = window.setTimeout(() => setDebouncedTeamGid(next), 300)
    return () => window.clearTimeout(id)
  }, [asanaParams.teamGid, debouncedTeamGid])

  const todayIso = useMemo(() => {
    const now = new Date()
    return toISODateString(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  const [dueOnPickerOpen, setDueOnPickerOpen] = useState(false)
  const [dueOnMonth, setDueOnMonth] = useState<CalendarMonth>(() =>
    getInitialMonth(asanaParams.dueOn)
  )
  const [dueOnManuallyEdited, setDueOnManuallyEdited] = useState(false)
  useEffect(() => {
    setDueOnMonth(getInitialMonth(asanaParams.dueOn))
    if (!asanaParams.dueOn) {
      setDueOnManuallyEdited(false)
    }
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
  const [dueAtManuallyEdited, setDueAtManuallyEdited] = useState(false)
  const dueAtParts = useMemo(
    () => parseIsoDateTime(asanaParams.dueAt),
    [asanaParams.dueAt]
  )
  const [dueAtMonth, setDueAtMonth] = useState<CalendarMonth>(() =>
    getInitialMonth(dueAtParts.date)
  )

  useEffect(() => {
    if (!selectedTaskDetails) return

    const t = selectedTaskDetails

    const patch: Partial<AsanaActionParams> = {
      name: t.name ?? '',
      notes: t.notes ?? '',
      completed: t.completed ?? false,
      assignee: t.assignee?.gid ?? '',
      dueOn: t.due_on ?? '',
      dueAt: t.due_at ?? '',
      additionalFields:
        t.custom_fields?.map((cf) => {
          const key = cf.name ?? cf.gid
          let value = ''
          if (cf.text_value != null) value = cf.text_value
          else if (cf.number_value != null) value = String(cf.number_value)
          else if (cf.enum_value?.name != null) value = cf.enum_value.name
          return { key, value }
        }) ?? []
    }

    applyAsanaPatch(patch)
  }, [selectedTaskDetails, applyAsanaPatch])

  useEffect(() => {
    setDueAtMonth(getInitialMonth(dueAtParts.date))
    if (!asanaParams.dueAt) {
      setDueAtManuallyEdited(false)
    }
  }, [asanaParams.dueAt, dueAtParts.date])

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
      setDueAtManuallyEdited(false)
      applyAsanaPatch({ dueAt: iso ?? '' })
    },
    [applyAsanaPatch, dueAtTimezone]
  )
  const handleDueAtTimezoneSelect = useCallback(
    (tz: string) => {
      setDueAtTimezone(tz)
      setDueAtManuallyEdited(false)
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

  const supportsDueMode =
    asanaParams.operation === 'createTask' ||
    asanaParams.operation === 'updateTask' ||
    asanaParams.operation === 'createSubtask'

  const [dueMode, setDueMode] = useState<'dueOn' | 'dueAt'>(
    asanaParams.dueAt?.trim() ? 'dueAt' : 'dueOn'
  )

  useEffect(() => {
    if (asanaParams.dueAt?.trim()) {
      setDueMode('dueAt')
    } else if (asanaParams.dueOn?.trim()) {
      setDueMode('dueOn')
    } else {
      setDueMode('dueOn')
    }
  }, [asanaParams.dueAt, asanaParams.dueOn])

  const hasWorkspaceSelected = Boolean(asanaParams.workspaceGid?.trim())
  const hasProjectSelected = Boolean(asanaParams.projectGid?.trim())
  const hasTaskSelected = Boolean(asanaParams.taskGid?.trim())
  const hasParentTaskSelected = Boolean(asanaParams.parentTaskGid?.trim())
  const projectSelectionValue = useMemo(
    () =>
      (asanaParams.projectSelection ?? '').trim() ||
      (asanaParams.projectGid ?? '').trim(),
    [asanaParams.projectGid, asanaParams.projectSelection]
  )
  const isManualProjectSelection = projectSelectionValue === MANUAL_OPTION_VALUE
  const taskSelectionValue = useMemo(
    () =>
      (asanaParams.taskSelection ?? '').trim() ||
      (asanaParams.taskGid ?? '').trim(),
    [asanaParams.taskGid, asanaParams.taskSelection]
  )
  const parentTaskSelectionValue = useMemo(
    () =>
      (asanaParams.parentTaskSelection ?? '').trim() ||
      (asanaParams.parentTaskGid ?? '').trim(),
    [asanaParams.parentTaskGid, asanaParams.parentTaskSelection]
  )
  const tagSelectionValue = useMemo(
    () =>
      (asanaParams.tagSelection ?? '').trim() ||
      (asanaParams.tagGid ?? '').trim(),
    [asanaParams.tagGid, asanaParams.tagSelection]
  )
  const storySelectionValue = useMemo(
    () =>
      (asanaParams.storySelection ?? '').trim() ||
      (asanaParams.storyGid ?? '').trim(),
    [asanaParams.storyGid, asanaParams.storySelection]
  )
  const assigneeSelectionValue = useMemo(
    () =>
      (asanaParams.assigneeSelection ?? '').trim() ||
      (asanaParams.assignee ?? '').trim(),
    [asanaParams.assignee, asanaParams.assigneeSelection]
  )

  const visibility = useMemo(() => {
    const op = asanaParams.operation
    const fieldVisibility: Record<FieldKey, boolean> = {
      workspaceGid: false,
      projectGid: false,
      taskGid: false,
      parentTaskGid: false,
      sectionGid: false,
      tagGid: false,
      userGid: false,
      storyGid: false,
      teamGid: false,
      name: false,
      notes: false,
      dueOn: false,
      dueAt: false,
      assignee: false,
      query: false,
      completed: false,
      archived: false,
      limit: false,
      additionalFields: false
    }

    const enableWorkspace = () => {
      fieldVisibility.workspaceGid = true
    }

    switch (op) {
      case 'createProject':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.name = true
          fieldVisibility.notes = true
          fieldVisibility.teamGid = true
          fieldVisibility.additionalFields = true
        }
        break
      case 'updateProject':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.name = true
          fieldVisibility.notes = true
          fieldVisibility.additionalFields = true
        }
        break
      case 'getProject':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }
        break
      case 'listProjects':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.teamGid = true
          fieldVisibility.limit = true
        }
        break
      case 'deleteProject':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }
        break
      case 'createTask':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
          fieldVisibility.name = true
          fieldVisibility.assignee = true
          fieldVisibility.notes = true
          if (dueMode != null) {
            fieldVisibility.dueOn = dueMode === 'dueOn'
            fieldVisibility.dueAt = dueMode === 'dueAt'
          }
          fieldVisibility.additionalFields = true
        }
        break
      case 'updateTask':
        enableWorkspace()
        // Show project selector once a workspace is chosen
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }

        // Show task selector/input after workspace is chosen (project optional)
        if (hasWorkspaceSelected) {
          fieldVisibility.taskGid = true
        }

        // Show editable task fields once a task is selected (dropdown or manual)
        if (hasWorkspaceSelected && hasTaskSelected) {
          fieldVisibility.name = true
          fieldVisibility.notes = true
          fieldVisibility.assignee = true
          fieldVisibility.completed = true
          fieldVisibility.dueOn = dueMode === 'dueOn'
          fieldVisibility.dueAt = dueMode === 'dueAt'
          fieldVisibility.additionalFields = true
        }
        break
      case 'getTask':
        enableWorkspace()
        // Show project selector when workspace is selected
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }

        // Show task selector when project is selected
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.taskGid = true
        }
        break
      case 'listTasks':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
          fieldVisibility.tagGid = true
          fieldVisibility.assignee = true
          fieldVisibility.limit = true
        }
        break
      case 'deleteTask':
        enableWorkspace()
        // Show project selector when workspace is selected
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }

        // Show task selector; allow manual Task GID when no project chosen
        if (hasWorkspaceSelected) {
          fieldVisibility.taskGid = true
        }
        break
      case 'searchTasks':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.query = true
          fieldVisibility.projectGid = true
          fieldVisibility.tagGid = true
          fieldVisibility.assignee = true
          fieldVisibility.completed = true
          fieldVisibility.limit = true
        }
        break
      case 'moveTask':
        enableWorkspace()
        // Show project selector when workspace is selected
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }

        // Show task selector only after a project is selected
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.taskGid = true
        }

        // Show section selector only after a task is selected
        if (hasWorkspaceSelected && hasProjectSelected && hasTaskSelected) {
          fieldVisibility.sectionGid = true
        }
        break
      case 'createSubtask':
        enableWorkspace()
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.parentTaskGid = true
          if (hasParentTaskSelected) {
            fieldVisibility.name = true
            fieldVisibility.assignee = true
            fieldVisibility.notes = true
            if (dueMode != null) {
              fieldVisibility.dueOn = dueMode === 'dueOn'
              fieldVisibility.dueAt = dueMode === 'dueAt'
            }
            fieldVisibility.additionalFields = true
          }
        }
        break
      case 'listSubtasks':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.parentTaskGid = true
          fieldVisibility.taskGid = true
        }
        if (
          hasWorkspaceSelected &&
          hasProjectSelected &&
          hasParentTaskSelected
        ) {
          fieldVisibility.limit = true
        }
        break
      case 'addComment':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.taskGid = true
        }
        if (hasWorkspaceSelected && hasProjectSelected && hasTaskSelected) {
          fieldVisibility.notes = true
        }
        break
      case 'removeComment':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.projectGid = true
        }
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.taskGid = true
        }
        if (hasWorkspaceSelected && hasProjectSelected && hasTaskSelected) {
          fieldVisibility.storyGid = true
        }
        break
      case 'addTaskProject':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.taskGid = true
          fieldVisibility.projectGid = true
        }
        break
      case 'removeTaskProject':
        enableWorkspace()
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.taskGid = true
        }
        if (hasWorkspaceSelected && hasTaskSelected) {
          fieldVisibility.projectGid = true
        }
        break
      case 'addTaskTag':
        enableWorkspace()
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.taskGid = true
        }
        if (hasWorkspaceSelected && hasProjectSelected && hasTaskSelected) {
          fieldVisibility.tagGid = true
        }
        break
      case 'removeTaskTag':
        enableWorkspace()
        if (hasWorkspaceSelected && hasProjectSelected) {
          fieldVisibility.taskGid = true
        }
        if (hasWorkspaceSelected && hasProjectSelected && hasTaskSelected) {
          fieldVisibility.tagGid = true
        }
        break
      case 'getUser':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.userGid = true
        }
        break
      case 'listUsers':
        enableWorkspace()
        if (hasWorkspaceSelected) {
          fieldVisibility.teamGid = true
          fieldVisibility.limit = true
        }
        break
      default:
        break
    }

    // Keep project positioned immediately after workspace in the required list
    // when the operation expects it (leave createTask's optional project in
    // the optional section).
    try {
      const cfg = OPERATION_FIELDS[op]
      if (hasWorkspaceSelected && cfg) {
        const wantsProject =
          (cfg.required || []).includes('projectGid') ||
          (cfg.optional || []).includes('projectGid')
        if (wantsProject) {
          fieldVisibility.projectGid = true
        }
      }
    } catch {
      /* ignore */
    }

    return fieldVisibility
  }, [
    asanaParams.operation,
    hasProjectSelected,
    hasParentTaskSelected,
    hasTaskSelected,
    hasWorkspaceSelected,
    dueMode
  ])

  const showDueModeSelector = useMemo(() => {
    switch (asanaParams.operation) {
      case 'createTask':
        return hasWorkspaceSelected
      case 'updateTask':
        return hasTaskSelected
      case 'createSubtask':
        return hasParentTaskSelected
      default:
        return false
    }
  }, [
    asanaParams.operation,
    hasParentTaskSelected,
    hasTaskSelected,
    hasWorkspaceSelected
  ])

  const handleDueModeChange = useCallback(
    (mode: 'dueOn' | 'dueAt') => {
      setDueMode(mode)
      if (mode === 'dueOn') {
        applyAsanaPatch({ dueAt: '' })
      } else {
        applyAsanaPatch({ dueOn: '' })
      }
    },
    [applyAsanaPatch]
  )

  const handleWorkspaceSelect = useCallback(
    (workspaceGid: string) => {
      applyAsanaPatch({
        workspaceGid,
        projectGid: '',
        projectSelection: '',
        sectionGid: '',
        tagGid: '',
        tagSelection: '',
        teamGid: '',
        userGid: '',
        taskGid: '',
        taskSelection: '',
        parentTaskGid: '',
        parentTaskSelection: '',
        storyGid: '',
        storySelection: '',
        assignee: '',
        assigneeSelection: ''
      })
    },
    [applyAsanaPatch]
  )

  const handleProjectSelect = useCallback(
    (projectGid: string) => {
      const isManual = projectGid === MANUAL_OPTION_VALUE
      const nextPatch: Partial<AsanaActionParams> = {
        projectGid: isManual ? '' : projectGid,
        projectSelection: projectGid,
        sectionGid: '',
        taskGid: '',
        taskSelection: '',
        parentTaskGid: '',
        parentTaskSelection: '',
        storyGid: '',
        storySelection: ''
      }

      if (asanaParams.operation !== 'createTask') {
        nextPatch.name = ''
        nextPatch.notes = ''
        nextPatch.assignee = ''
        nextPatch.completed = false
        nextPatch.dueOn = ''
        nextPatch.dueAt = ''
        nextPatch.additionalFields = []
      }

      applyAsanaPatch(nextPatch)
    },
    [applyAsanaPatch, asanaParams.operation]
  )

  const handleProjectInputChange = useCallback(
    (projectGid: string) => {
      applyAsanaPatch({
        projectGid,
        projectSelection: MANUAL_OPTION_VALUE,
        sectionGid: '',
        taskGid: '',
        taskSelection: '',
        parentTaskGid: '',
        storyGid: '',
        storySelection: ''
      })
    },
    [applyAsanaPatch]
  )

  const handleTagSelect = useCallback(
    (tagGid: string) => {
      if (tagGid === MANUAL_OPTION_VALUE) {
        applyAsanaPatch({
          tagGid: '',
          tagSelection: MANUAL_OPTION_VALUE
        })
        return
      }
      applyAsanaPatch({
        tagGid,
        tagSelection: tagGid
      })
    },
    [applyAsanaPatch]
  )

  const handleTagInputChange = useCallback(
    (tagGid: string) => {
      applyAsanaPatch({
        tagGid,
        tagSelection: MANUAL_OPTION_VALUE
      })
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

  const handleAssigneeSelect = useCallback(
    (assignee: string) => {
      if (assignee === MANUAL_OPTION_VALUE) {
        applyAsanaPatch({
          assignee: '',
          assigneeSelection: MANUAL_OPTION_VALUE
        })
        return
      }
      applyAsanaPatch({
        assignee,
        assigneeSelection: assignee
      })
    },
    [applyAsanaPatch]
  )

  const handleAssigneeInputChange = useCallback(
    (assignee: string) => {
      applyAsanaPatch({
        assignee,
        assigneeSelection: MANUAL_OPTION_VALUE
      })
    },
    [applyAsanaPatch]
  )

  const handleSectionSelect = useCallback(
    (sectionGid: string) => {
      applyAsanaPatch({ sectionGid })
    },
    [applyAsanaPatch]
  )

  const [pendingPrefillTaskId, setPendingPrefillTaskId] = useState<
    string | null
  >(null)

  const handleTaskSelect = useCallback(
    (taskGid: string) => {
      const next: Partial<AsanaActionParams> = {
        taskGid,
        taskSelection: taskGid,
        storyGid: '',
        storySelection: ''
      }

      // For updateTask operation, populate fields from the task data
      if (asanaParams.operation === 'updateTask') {
        const taskDetails = taskDetailsMap.get(taskGid)

        // Populate all fields from the task data
        if (taskDetails) {
          Object.assign(next, buildTaskPrefillFromDetails(taskDetails))
        } else {
          // Fallback: just use the name from taskOptions
          const found = taskOptions.find(
            (o) => typeof o === 'object' && o.value === taskGid
          )
          if (found) {
            next.name =
              typeof found === 'object' && typeof found.label === 'string'
                ? found.label
                : ''
          }
          next.additionalFields = []
        }
      }

      applyAsanaPatch(next)
    },
    [
      applyAsanaPatch,
      asanaParams.operation,
      taskOptions,
      taskDetailsMap,
      buildTaskPrefillFromDetails
    ]
  )

  const handleTaskDropdownChange = useCallback(
    (taskGid: string) => {
      if (taskGid === MANUAL_OPTION_VALUE) {
        applyAsanaPatch({ taskSelection: MANUAL_OPTION_VALUE })
        return
      }
      handleTaskSelect(taskGid)
    },
    [applyAsanaPatch, handleTaskSelect]
  )

  const handleManualTaskChange = useCallback(
    (taskGid: string) => {
      setSelectedTaskDetails(null)
      applyAsanaPatch({
        taskGid,
        taskSelection: MANUAL_OPTION_VALUE,
        storySelection: ''
      })
    },
    [applyAsanaPatch]
  )

  const handleManualTaskBlur = useCallback(
    (taskGid: string) => {
      if (
        asanaParams.operation !== 'updateTask' ||
        hasProjectSelected ||
        !asanaConnectionOptions
      ) {
        return
      }

      const trimmed = taskGid.trim()
      if (!trimmed) return

      // Manual Task GID entry should not trigger API fetches or auto-prefill.
      applyAsanaPatch({
        taskGid: trimmed,
        taskSelection: MANUAL_OPTION_VALUE
      })
    },
    [
      applyAsanaPatch,
      asanaConnectionOptions,
      asanaParams.operation,
      hasProjectSelected
    ]
  )

  // Auto-populate first task for updateTask operation
  useEffect(() => {
    if (
      asanaParams.operation === 'updateTask' &&
      taskOptions.length > 0 &&
      !asanaParams.taskGid && // Only if no task selected yet
      taskDetailsMap.size > 0 &&
      hasProjectSelected &&
      !taskOptionsLoading // Don't run while loading
    ) {
      // Make sure the first task is actually in our details map
      const firstTaskGid =
        typeof taskOptions[0] === 'object' ? taskOptions[0].value : ''
      if (taskDetailsMap.has(firstTaskGid)) {
        handleTaskSelect(firstTaskGid)
      }
    }
  }, [
    asanaParams.operation,
    asanaParams.taskGid,
    taskOptions,
    taskDetailsMap,
    hasProjectSelected,
    handleTaskSelect,
    taskOptionsLoading // Add this dependency
  ])

  // Clear task selection if the selected task is not in the current project
  useEffect(() => {
    if (
      asanaParams.operation === 'updateTask' &&
      asanaParams.taskGid &&
      taskOptions.length > 0 &&
      !taskOptionsLoading
    ) {
      // Check if the current taskGid exists in the loaded tasks
      const taskExists = taskOptions.some(
        (opt) => typeof opt === 'object' && opt.value === asanaParams.taskGid
      )

      if (!taskExists) {
        // Current task doesn't exist in this project, clear it
        applyAsanaPatch({
          taskGid: '',
          taskSelection: '',
          name: '',
          notes: '',
          assignee: '',
          assigneeSelection: '',
          completed: false,
          dueOn: '',
          dueAt: '',
          additionalFields: [],
          storySelection: ''
        })
      }
    }
  }, [
    asanaParams.operation,
    asanaParams.taskGid,
    taskOptions,
    taskOptionsLoading,
    applyAsanaPatch
  ])

  useEffect(() => {
    if (asanaParams.operation !== 'updateTask') return
    if (!visibility.name) return
    if (!pendingPrefillTaskId) return
    if (asanaParams.taskGid !== pendingPrefillTaskId) return

    const found = taskOptions.find(
      (o) => typeof o === 'object' && o.value === pendingPrefillTaskId
    )

    if (found && typeof found === 'object' && typeof found.label === 'string') {
      applyAsanaPatch({ name: found.label })
    }

    setPendingPrefillTaskId(null)
  }, [
    asanaParams.operation,
    asanaParams.taskGid,
    visibility.name,
    taskOptions,
    pendingPrefillTaskId,
    applyAsanaPatch
  ])

  useEffect(() => {
    if (
      asanaParams.operation === 'addTaskProject' &&
      taskSelectionValue !== MANUAL_OPTION_VALUE
    ) {
      applyAsanaPatch({ taskSelection: MANUAL_OPTION_VALUE })
    }
  }, [applyAsanaPatch, asanaParams.operation, taskSelectionValue])

  const handleParentTaskSelect = useCallback(
    (parentTaskGid: string) => {
      if (parentTaskGid === MANUAL_OPTION_VALUE) {
        applyAsanaPatch({
          parentTaskGid: '',
          parentTaskSelection: MANUAL_OPTION_VALUE
        })
        return
      }
      applyAsanaPatch({
        parentTaskGid,
        parentTaskSelection: parentTaskGid
      })
    },
    [applyAsanaPatch]
  )

  const handleParentTaskInputChange = useCallback(
    (parentTaskGid: string) => {
      applyAsanaPatch({
        parentTaskGid,
        parentTaskSelection: MANUAL_OPTION_VALUE
      })
    },
    [applyAsanaPatch]
  )

  const handleStorySelect = useCallback(
    (storyGid: string) => {
      if (storyGid === MANUAL_OPTION_VALUE) {
        applyAsanaPatch({
          storyGid: '',
          storySelection: MANUAL_OPTION_VALUE
        })
        return
      }
      applyAsanaPatch({ storyGid, storySelection: storyGid })
    },
    [applyAsanaPatch]
  )

  const handleStoryInputChange = useCallback(
    (storyGid: string) => {
      applyAsanaPatch({
        storyGid,
        storySelection: MANUAL_OPTION_VALUE
      })
    },
    [applyAsanaPatch]
  )

  const shouldFetchWorkspaces = useMemo(
    () => hasConnection && !isSoloPlan && visibility.workspaceGid,
    [hasConnection, isSoloPlan, visibility.workspaceGid]
  )

  const shouldFetchProjects = useMemo(
    () =>
      hasConnection &&
      !isSoloPlan &&
      visibility.projectGid &&
      debouncedWorkspaceGid,
    [debouncedWorkspaceGid, hasConnection, isSoloPlan, visibility.projectGid]
  )

  const shouldFetchTasks = useMemo(
    () =>
      hasConnection &&
      !isSoloPlan &&
      asanaParams.operation !== 'addTaskProject' &&
      taskSelectionValue !== MANUAL_OPTION_VALUE &&
      !isManualProjectSelection &&
      (visibility.taskGid || visibility.parentTaskGid || visibility.storyGid) &&
      debouncedWorkspaceGid &&
      debouncedProjectGid,
    [
      asanaParams.operation,
      debouncedProjectGid,
      debouncedWorkspaceGid,
      hasConnection,
      isManualProjectSelection,
      isSoloPlan,
      taskSelectionValue,
      visibility.parentTaskGid,
      visibility.storyGid,
      visibility.taskGid
    ]
  )

  useEffect(() => {
    // Only fetch if we actually need to show the workspace dropdown
    if (!asanaConnectionOptions || !shouldFetchWorkspaces) {
      setWorkspaceOptions([])
      setWorkspaceOptionsError(null)
      setWorkspaceOptionsLoading(false)
      return
    }

    let cancelled = false
    setWorkspaceOptions([])
    setWorkspaceOptionsError(null)
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
  }, [asanaConnectionOptions, shouldFetchWorkspaces])

  useEffect(() => {
    if (!asanaConnectionOptions || !shouldFetchProjects) {
      setProjectOptions([])
      setProjectOptionsError(null)
      setProjectOptionsLoading(false)
      return
    }

    let cancelled = false
    setProjectOptions([])
    setProjectOptionsError(null)
    setProjectOptionsLoading(true)
    fetchAsanaProjects(debouncedWorkspaceGid, asanaConnectionOptions)
      .then((projects: AsanaProject[]) => {
        if (cancelled) return
        setProjectOptions(
          projects.map((project) => ({
            value: project.gid,
            label: project.name || project.gid
          }))
        )
        setProjectOptionsError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setProjectOptionsError(
          err instanceof Error ? err.message : 'Failed to load Asana projects'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setProjectOptionsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [asanaConnectionOptions, debouncedWorkspaceGid, shouldFetchProjects])

  useEffect(() => {
    setTagOptions([])
    setTagOptionsError(null)
    setTagOptionsLoading(false)
    const workspaceGid = debouncedWorkspaceGid
    if (
      !visibility.tagGid ||
      !workspaceGid ||
      !asanaConnectionOptions ||
      isSoloPlan
    ) {
      return
    }

    let cancelled = false
    setTagOptionsLoading(true)
    fetchAsanaTags(workspaceGid, asanaConnectionOptions)
      .then((tags: AsanaTag[]) => {
        if (cancelled) return
        setTagOptions(
          tags.map((tag) => ({
            value: tag.gid,
            label: tag.name || tag.gid
          }))
        )
        setTagOptionsError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTagOptionsError(
          err instanceof Error ? err.message : 'Failed to load Asana tags'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setTagOptionsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    asanaConnectionOptions,
    debouncedWorkspaceGid,
    isSoloPlan,
    visibility.tagGid
  ])

  useEffect(() => {
    setTeamOptions([])
    setTeamOptionsError(null)
    setTeamOptionsLoading(false)
    const workspaceGid = debouncedWorkspaceGid
    if (
      !visibility.teamGid ||
      !workspaceGid ||
      !asanaConnectionOptions ||
      isSoloPlan
    ) {
      return
    }

    let cancelled = false
    setTeamOptionsLoading(true)
    fetchAsanaTeams(workspaceGid, asanaConnectionOptions)
      .then((teams: AsanaTeam[]) => {
        if (cancelled) return
        setTeamOptions(
          teams.map((team) => ({
            value: team.gid,
            label: team.name || team.gid
          }))
        )
        setTeamOptionsError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTeamOptionsError(
          err instanceof Error ? err.message : 'Failed to load Asana teams'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setTeamOptionsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    asanaConnectionOptions,
    debouncedWorkspaceGid,
    isSoloPlan,
    visibility.teamGid
  ])

  useEffect(() => {
    setUserOptions([])
    setUserOptionsError(null)
    setUserOptionsLoading(false)
    const workspaceGid = debouncedWorkspaceGid
    const shouldFetchUsers = visibility.assignee || visibility.userGid
    if (
      !shouldFetchUsers ||
      !workspaceGid ||
      !asanaConnectionOptions ||
      isSoloPlan
    ) {
      return
    }

    let cancelled = false
    setUserOptionsLoading(true)
    fetchAsanaUsers(
      workspaceGid,
      asanaConnectionOptions,
      debouncedTeamGid || undefined
    )
      .then((users: AsanaUser[]) => {
        if (cancelled) return
        setUserOptions(
          users.map((user) => ({
            value: user.gid,
            label: user.email
              ? `${user.name || user.gid} (${user.email})`
              : user.name || user.gid
          }))
        )
        setUserOptionsError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setUserOptionsError(
          err instanceof Error ? err.message : 'Failed to load Asana users'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setUserOptionsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    asanaConnectionOptions,
    debouncedWorkspaceGid,
    debouncedTeamGid,
    isSoloPlan,
    visibility.assignee,
    visibility.userGid
  ])

  const handlePlanUpgradeClick = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    setSectionOptions([])
    setSectionOptionsError(null)
    const projectGid = debouncedProjectGid
    if (
      !visibility.sectionGid ||
      !projectGid ||
      !asanaConnectionOptions ||
      isSoloPlan
    ) {
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
  }, [
    asanaConnectionOptions,
    debouncedProjectGid,
    isSoloPlan,
    visibility.sectionGid
  ])

  useEffect(() => {
    if (!asanaConnectionOptions || !shouldFetchTasks) {
      setTaskOptions([])
      setTaskOptionsError(null)
      setTaskDetailsMap(new Map())
      setTaskOptionsLoading(false)
      return
    }

    let cancelled = false
    setTaskOptions([])
    setTaskOptionsError(null)
    setTaskDetailsMap(new Map())
    setTaskOptionsLoading(true)
    fetchAsanaTasks(
      debouncedWorkspaceGid,
      asanaConnectionOptions,
      debouncedProjectGid || undefined
    )
      .then((tasks: AsanaTask[]) => {
        if (cancelled) return

        const detailsMap = new Map<string, AsanaTask>()
        tasks.forEach((task) => {
          detailsMap.set(task.gid, task)
        })
        setTaskDetailsMap(detailsMap)

        setTaskOptions(
          tasks.map((task) => ({
            value: task.gid,
            label: task.name || task.gid
          }))
        )
        setTaskOptionsError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTaskOptionsError(
          err instanceof Error
            ? err.message
            : 'Failed to load Asana tasks for this workspace'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setTaskOptionsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    asanaConnectionOptions,
    debouncedWorkspaceGid,
    debouncedProjectGid,
    shouldFetchTasks
  ])

  useEffect(() => {
    if (!selectedTaskDetails) return

    const next = buildTaskPrefillFromDetails(selectedTaskDetails)
    if (Object.keys(next).length > 0) {
      applyAsanaPatch(next)
    }
  }, [applyAsanaPatch, buildTaskPrefillFromDetails, selectedTaskDetails])

  useEffect(() => {
    if (!asanaParams.taskGid?.trim()) {
      setSelectedTaskDetails(null)
    }
  }, [asanaParams.taskGid])

  useEffect(() => {
    setSelectedTaskDetails(null)
  }, [asanaParams.projectGid])

  useEffect(() => {
    setCommentOptions([])
    setCommentOptionsError(null)
    const taskGid = (asanaParams.taskGid ?? '').trim()
    if (
      !visibility.storyGid ||
      !taskGid ||
      !asanaConnectionOptions ||
      isSoloPlan ||
      storySelectionValue === MANUAL_OPTION_VALUE
    ) {
      setCommentOptionsLoading(false)
      return
    }

    let cancelled = false
    setCommentOptionsLoading(true)
    fetchAsanaStories(taskGid, asanaConnectionOptions)
      .then((stories: AsanaStory[]) => {
        if (cancelled) return
        setCommentOptions(
          stories.map((story) => ({
            value: story.gid,
            label: story.text || story.gid
          }))
        )
        setCommentOptionsError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCommentOptionsError(
          err instanceof Error
            ? err.message
            : 'Failed to load Asana comments for this task'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setCommentOptionsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    asanaConnectionOptions,
    asanaParams.taskGid,
    isSoloPlan,
    storySelectionValue,
    visibility.storyGid
  ])

  const selectedConnectionValue = useMemo(() => {
    if (!activeConnection?.connectionId || !activeConnection.connectionScope)
      return ''
    return connectionValueKey(
      activeConnection.connectionScope as AsanaConnectionScope,
      activeConnection.connectionId
    )
  }, [activeConnection?.connectionScope, activeConnection?.connectionId])

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
    const req = (config.required || []).filter((field) => visibility[field])
    const opt = (config.optional ?? []).filter((field) => visibility[field])

    // Ensure projectGid (when visible) is positioned immediately after
    // workspaceGid in the rendered required fields. We will build the
    // required list placing workspace then project (if present), then the
    // remaining required fields. The optional list will exclude project if
    // it was promoted into the required ordering so it isn't rendered twice.
    const requiredOrdered: FieldKey[] = []
    const optionalFiltered: FieldKey[] = [...opt]

    if (visibility['workspaceGid']) {
      // include workspace if present in either required or optional
      if (req.includes('workspaceGid') || opt.includes('workspaceGid')) {
        requiredOrdered.push('workspaceGid')
      }

      if (asanaParams.operation === 'addTaskProject') {
        if (visibility['taskGid'] && req.includes('taskGid')) {
          requiredOrdered.push('taskGid')
        }
        if (visibility['projectGid']) {
          if (req.includes('projectGid') || opt.includes('projectGid')) {
            requiredOrdered.push('projectGid')
            const idx = optionalFiltered.indexOf('projectGid')
            if (idx !== -1) optionalFiltered.splice(idx, 1)
          }
        }
        req.forEach((f) => {
          if (f === 'workspaceGid' || f === 'projectGid' || f === 'taskGid')
            return
          requiredOrdered.push(f)
        })
        return { required: requiredOrdered, optional: optionalFiltered }
      }

      // include project immediately after workspace if visible
      if (visibility['projectGid']) {
        const projectIsRequired = req.includes('projectGid')
        const projectIsOptional =
          opt.includes('projectGid') && asanaParams.operation !== 'createTask'
        if (projectIsRequired || projectIsOptional) {
          requiredOrdered.push('projectGid')
          // remove project from optionalFiltered if present
          const idx = optionalFiltered.indexOf('projectGid')
          if (idx !== -1) optionalFiltered.splice(idx, 1)
        }
      }

      // add remaining required fields (excluding workspace/project duplicates)
      req.forEach((f) => {
        if (f === 'workspaceGid' || f === 'projectGid') return
        requiredOrdered.push(f)
      })

      // optionalFiltered already has project removed if promoted; keep order
      return { required: requiredOrdered, optional: optionalFiltered }
    }
  }, [asanaParams.operation, visibility])

  const renderField = (field: FieldKey, _isRequired: boolean) => {
    const meta = FIELD_META[field]
    const value = (asanaParams as Record<string, unknown>)[field]
    const error = validation.errors[field]
    const labelText = meta.label

    if (field === 'dueOn' && supportsDueMode && dueMode !== 'dueOn') {
      return null
    }
    if (field === 'dueAt' && supportsDueMode && dueMode !== 'dueAt') {
      return null
    }

    if (!visibility[field]) {
      return null
    }

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
            searchable
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
            options={projectDropdownOptions}
            value={projectSelectionValue || currentValue}
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
            searchable
          />
          <NodeInputField
            value={currentValue}
            onChange={handleProjectInputChange}
            placeholder="Project GID (supports templates)"
            disabled={
              !effectiveCanEdit || !hasConnection || !asanaParams.workspaceGid
            }
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
            searchable
          />
          {sectionOptionsError && (
            <p className="text-xs text-red-500">{sectionOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'taskGid') {
      const currentValue = typeof value === 'string' ? value : ''
      const useManualTaskInput =
        (asanaParams.operation === 'updateTask' ||
          asanaParams.operation === 'deleteTask') &&
        !hasProjectSelected
      const showTaskDropdown =
        asanaParams.operation !== 'addTaskProject' && !useManualTaskInput
      const taskDropdownValue = taskSelectionValue || currentValue

      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          {showTaskDropdown ? (
            <NodeDropdownField
              options={[MANUAL_OPTION, ...taskOptions]}
              value={taskDropdownValue}
              onChange={handleTaskDropdownChange}
              placeholder={
                !hasConnection
                  ? 'Select an Asana connection first'
                  : debouncedWorkspaceGid
                    ? debouncedProjectGid
                      ? taskOptionsLoading
                        ? 'Loading tasks...'
                        : 'Select task'
                      : 'Select a project first'
                    : 'Select a workspace first'
              }
              disabled={
                !effectiveCanEdit ||
                !hasConnection ||
                taskOptionsLoading ||
                !debouncedWorkspaceGid
              }
              loading={taskOptionsLoading}
              emptyMessage={taskOptionsError || 'No tasks available'}
              searchable
            />
          ) : null}
          <NodeInputField
            value={currentValue}
            onChange={handleManualTaskChange}
            onBlur={handleManualTaskBlur}
            disabled={
              !effectiveCanEdit || !hasConnection || !debouncedWorkspaceGid
            }
            placeholder={
              !hasConnection
                ? 'Select an Asana connection first'
                : debouncedWorkspaceGid
                  ? 'Task GID (supports templates)'
                  : 'Select a workspace first'
            }
          />
          {taskOptionsError && showTaskDropdown && (
            <p className="text-xs text-red-500">{taskOptionsError}</p>
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
            options={[NO_TAG_OPTION, MANUAL_OPTION, ...tagOptions]}
            value={tagSelectionValue || currentValue}
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
            searchable
          />
          <NodeInputField
            value={currentValue}
            onChange={handleTagInputChange}
            placeholder="Tag GID (supports templates)"
            disabled={
              !effectiveCanEdit || !hasConnection || !asanaParams.workspaceGid
            }
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
            options={[NO_ASSIGNEE_OPTION, MANUAL_OPTION, ...userOptions]}
            value={assigneeSelectionValue || currentValue}
            onChange={handleAssigneeSelect}
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
            searchable
          />
          <NodeInputField
            value={currentValue}
            onChange={handleAssigneeInputChange}
            placeholder="Assignee GID (supports templates)"
            disabled={
              !effectiveCanEdit || !hasConnection || !asanaParams.workspaceGid
            }
          />
          {userOptionsError && (
            <p className="text-xs text-red-500">{userOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    if (field === 'parentTaskGid') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={[MANUAL_OPTION, ...taskOptions]}
            value={parentTaskSelectionValue || currentValue}
            onChange={handleParentTaskSelect}
            placeholder={
              !hasConnection
                ? 'Select an Asana connection first'
                : debouncedWorkspaceGid
                  ? debouncedProjectGid
                    ? taskOptionsLoading
                      ? 'Loading tasks...'
                      : 'Select task'
                    : 'Select a project first'
                  : 'Select a workspace first'
            }
            disabled={
              !effectiveCanEdit ||
              !hasConnection ||
              taskOptionsLoading ||
              !debouncedWorkspaceGid
            }
            loading={taskOptionsLoading}
            emptyMessage={taskOptionsError || 'No tasks available'}
            searchable
          />
          <NodeInputField
            value={currentValue}
            onChange={handleParentTaskInputChange}
            placeholder="Parent task GID (supports templates)"
            disabled={
              !effectiveCanEdit || !hasConnection || !debouncedWorkspaceGid
            }
          />
          {taskOptionsError && (
            <p className="text-xs text-red-500">{taskOptionsError}</p>
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

    if (field === 'storyGid') {
      const currentValue = typeof value === 'string' ? value : ''
      return (
        <div key={field} className="space-y-1">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            {labelText}
          </p>
          <NodeDropdownField
            options={[MANUAL_OPTION, ...commentOptions]}
            value={storySelectionValue || currentValue}
            onChange={handleStorySelect}
            placeholder={
              !asanaParams.taskGid
                ? 'Select a task first'
                : commentOptionsLoading
                  ? 'Loading comments...'
                  : 'Select comment'
            }
            disabled={
              !effectiveCanEdit ||
              commentOptionsLoading ||
              !asanaParams.taskGid ||
              !hasConnection
            }
            loading={commentOptionsLoading}
            emptyMessage={commentOptionsError || 'No comments available'}
            searchable
          />
          <NodeInputField
            value={currentValue}
            onChange={handleStoryInputChange}
            placeholder="Comment GID (supports templates)"
            disabled={
              !effectiveCanEdit ||
              !asanaParams.taskGid ||
              !hasConnection ||
              commentOptionsLoading
            }
          />
          {commentOptionsError && (
            <p className="text-xs text-red-500">{commentOptionsError}</p>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    // Due-mode selector is rendered once in the main form (not per-field)

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
                  selectedDate={dueOnManuallyEdited ? '' : dateValue}
                  todayISO={todayIso}
                  onMonthChange={(month) => setDueOnMonth(month)}
                  onSelectDate={(isoDate) => {
                    setDueOnPickerOpen(false)
                    setDueOnMonth(getInitialMonth(isoDate))
                    setDueOnManuallyEdited(false)
                    applyAsanaPatch({ dueOn: isoDate })
                  }}
                />
              </div>
            ) : null}
          </div>
          <NodeInputField
            value={dateValue}
            onChange={(val) => {
              setDueOnManuallyEdited(true)
              setDueOnPickerOpen(false)
              applyAsanaPatch({ dueOn: val })
            }}
            placeholder="YYYY-MM-DD or template"
            disabled={!effectiveCanEdit}
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
                {dueAtParts.valid && !dueAtManuallyEdited
                  ? formatDisplayDate(dueAtParts.date)
                  : 'Select date'}
              </span>
            </button>
            {dueAtCalendarOpen ? (
              <div className="absolute z-30 mt-2">
                <ScheduleCalendar
                  month={dueAtMonth}
                  selectedDate={dueAtManuallyEdited ? '' : dueAtParts.date}
                  todayISO={todayIso}
                  onMonthChange={(month) => setDueAtMonth(month)}
                  onSelectDate={(isoDate) => {
                    setDueAtCalendarOpen(false)
                    setDueAtMonth(getInitialMonth(isoDate))
                    setDueAtManuallyEdited(false)
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                  {dueAtParts.valid && !dueAtManuallyEdited
                    ? formatDisplayTime(dueAtTimeString)
                    : 'Select time'}
                </span>
              </button>
              {dueAtTimeOpen ? (
                <div className="absolute z-30 mt-2">
                  <ScheduleTimePicker
                    selectedTime={
                      dueAtManuallyEdited ? undefined : dueAtTimeParts
                    }
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
            value={asanaParams.dueAt ?? ''}
            onChange={(val) => {
              setDueAtManuallyEdited(true)
              setDueAtCalendarOpen(false)
              setDueAtTimeOpen(false)
              setDueAtTimezoneOpen(false)
              setDueAtTimezone('')
              setDueAtMonth(getInitialMonth(val))
              applyAsanaPatch({ dueAt: val })
            }}
            placeholder="ISO datetime or template"
            disabled={!effectiveCanEdit}
          />
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

  if (isSoloPlan) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
        <div className="flex items-start justify-between gap-2">
          <span>
            'Asana actions are available on workspace plans and above. Upgrade
            in Settings → Plan to run this step.'
          </span>
          <button
            type="button"
            onClick={handlePlanUpgradeClick}
            className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-400/10"
          >
            Upgrade
          </button>
        </div>
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

      {hasConnection && (
        <>
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
              onChange={(val) => handleOperationChange(val as string)}
              disabled={!effectiveCanEdit}
              searchable
            />
          </div>

          <div className="space-y-3">
            {visibleFields?.required && visibleFields.required.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Required fields
                </p>
                {asanaParams.operation === 'listTasks' && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-400/50 dark:bg-amber-950/30 dark:text-amber-100">
                    Provide exactly one: project, tag, or assignee (requires
                    workspace). Selecting more than one will fail.
                  </div>
                )}
                <div className="space-y-2">
                  {visibleFields?.required.map((field) =>
                    renderField(field, true)
                  )}
                </div>
              </div>
            )}

            {visibleFields?.optional && visibleFields?.optional?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Optional fields
                </p>
                <div className="space-y-2">
                  {(() => {
                    const nodes: React.ReactNode[] = []
                    const specialBefore: FieldKey[] =
                      asanaParams.operation === 'createTask'
                        ? ['projectGid', 'assignee']
                        : ['assignee']
                    const specialAfter: FieldKey[] = [
                      'notes',
                      'additionalFields'
                    ]

                    if (
                      asanaParams.operation === 'createTask' ||
                      asanaParams.operation === 'updateTask' ||
                      asanaParams.operation === 'createSubtask'
                    ) {
                      // 1) Assignee first
                      specialBefore.forEach((optField) => {
                        if (visibility[optField]) {
                          const node = renderField(optField, false)
                          if (node)
                            nodes.push(
                              <div key={`opt-${optField}`}>{node}</div>
                            )
                        }
                      })

                      // 2) Due mode selector
                      if (supportsDueMode && showDueModeSelector) {
                        nodes.push(
                          <div className="space-y-1" key="due-mode-opt">
                            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                              Due field
                            </p>
                            <NodeDropdownField
                              options={[
                                { label: 'Due on (date)', value: 'dueOn' },
                                { label: 'Due at (datetime)', value: 'dueAt' }
                              ]}
                              value={dueMode}
                              onChange={(val) =>
                                handleDueModeChange(
                                  val === 'dueAt' ? 'dueAt' : 'dueOn'
                                )
                              }
                              disabled={!effectiveCanEdit}
                            />
                          </div>
                        )
                      }

                      // 3) DueOn / DueAt fields (only one will render depending on dueMode)
                      ;['dueOn', 'dueAt'].forEach((df) => {
                        const node = renderField(df as FieldKey, false)
                        if (node)
                          nodes.push(<div key={`opt-${df}`}>{node}</div>)
                      })

                      // 4) Notes and Additional fields
                      specialAfter.forEach((optField) => {
                        if (visibility[optField]) {
                          const node = renderField(optField, false)
                          if (node)
                            nodes.push(
                              <div key={`opt-${optField}`}>{node}</div>
                            )
                        }
                      })
                    }

                    const rest = visibleFields?.optional.filter((f) => {
                      if (
                        asanaParams.operation === 'createTask' ||
                        asanaParams.operation === 'updateTask' ||
                        asanaParams.operation === 'createSubtask'
                      ) {
                        return ![
                          ...specialBefore,
                          ...specialAfter,
                          'dueOn',
                          'dueAt'
                        ].includes(f as FieldKey)
                      }
                      return true
                    })
                    rest?.forEach((field) => {
                      const node = renderField(field, false)
                      if (node)
                        nodes.push(<div key={`opt-rest-${field}`}>{node}</div>)
                    })

                    return nodes
                  })()}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

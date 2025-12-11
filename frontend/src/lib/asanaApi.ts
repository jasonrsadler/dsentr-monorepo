import { API_BASE_URL } from './config'
import type { ConnectionScope } from './oauthApi'

interface AsanaApiResponse {
  success?: boolean
  message?: string
  [key: string]: unknown
}

interface WorkspacesApiResponse extends AsanaApiResponse {
  workspaces?: { gid?: string; name?: string | null }[]
}

interface ProjectsApiResponse extends AsanaApiResponse {
  projects?: { gid?: string; name?: string | null }[]
}

interface TagsApiResponse extends AsanaApiResponse {
  tags?: { gid?: string; name?: string | null }[]
}

interface SectionsApiResponse extends AsanaApiResponse {
  sections?: { gid?: string; name?: string | null }[]
}

interface TeamsApiResponse extends AsanaApiResponse {
  teams?: { gid?: string; name?: string | null }[]
}

interface UsersApiResponse extends AsanaApiResponse {
  users?: { gid?: string; name?: string | null; email?: string | null }[]
}

interface TasksApiResponse extends AsanaApiResponse {
  tasks?: AsanaTask[] | null
}

interface StoriesApiResponse extends AsanaApiResponse {
  stories?: { gid?: string; text?: string | null }[]
}

interface TaskDetailsApiResponse extends AsanaApiResponse {
  task?: AsanaTask
}

export interface AsanaWorkspace {
  gid: string
  name: string
}

export interface AsanaProject {
  gid: string
  name: string
}

export interface AsanaTag {
  gid: string
  name: string
}

export interface AsanaSection {
  gid: string
  name: string
}

export interface AsanaTeam {
  gid: string
  name: string
}

export interface AsanaUser {
  gid: string
  name: string
  email?: string
}

export interface AsanaTask {
  gid: string
  name: string
  notes: string
  due_on: string | null
  due_at: string | null
  completed: boolean
  assignee: {
    gid: string
    name: string
    email: string | null
  } | null
  custom_fields: {
    gid: string
    name: string
    type: string
    text_value: string | null
    number_value: number | null
    enum_value: { name: string } | null
  }[]
}

export interface AsanaUserRef {
  gid: string
  name: string | null
  email: string | null
}

export interface AsanaCustomField {
  gid: string
  name: string | null
  type: string | null
  text_value: string | null
  number_value: number | null
  enum_value: AsanaEnumValue | null
}

export interface AsanaEnumValue {
  name: string | null
}

export interface AsanaStory {
  gid: string
  text: string
}

export interface AsanaConnectionOptions {
  scope?: ConnectionScope
  connectionId?: string | null
}

function appendConnectionQuery(
  path: string,
  options?: AsanaConnectionOptions,
  extraParams?: Record<string, string | undefined>
): string {
  const params = new URLSearchParams()

  if (options?.scope) {
    params.set('scope', options.scope)
  }

  const trimmedId = options?.connectionId?.trim()
  if (trimmedId) {
    params.set('connection_id', trimmedId)
  }

  if (extraParams) {
    Object.entries(extraParams).forEach(([key, value]) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        params.set(key, value.trim())
      }
    })
  }

  const query = params.toString()
  return query ? `${path}?${query}` : path
}

async function requestJson<T extends AsanaApiResponse>(
  path: string,
  errorLabel: string
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include'
  })

  let payload: T | null = null
  try {
    payload = (await res.json()) as T
  } catch {
    payload = null
  }

  const success = payload?.success !== false && res.ok
  if (!success) {
    const message = payload?.message || `${errorLabel} request failed`
    throw new Error(message)
  }

  return payload ?? ({ success: true } as T)
}

export async function fetchAsanaWorkspaces(
  options?: AsanaConnectionOptions
): Promise<AsanaWorkspace[]> {
  const data = await requestJson<WorkspacesApiResponse>(
    appendConnectionQuery('/api/asana/workspaces', options),
    'Asana workspaces'
  )

  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : []
  return workspaces
    .filter((workspace) => typeof workspace?.gid === 'string' && workspace.gid)
    .map((workspace) => {
      const gid = workspace!.gid!.trim()
      const name =
        (workspace!.name && workspace!.name!.trim()) ||
        (gid.length > 0 ? gid : 'Workspace')
      return {
        gid,
        name
      }
    })
    .filter((workspace) => workspace.gid.length > 0)
}

export async function fetchAsanaProjects(
  workspaceGid: string,
  options?: AsanaConnectionOptions
): Promise<AsanaProject[]> {
  if (!workspaceGid.trim()) return []

  const encodedWorkspace = encodeURIComponent(workspaceGid.trim())
  const data = await requestJson<ProjectsApiResponse>(
    appendConnectionQuery(
      `/api/asana/workspaces/${encodedWorkspace}/projects`,
      options
    ),
    'Asana projects'
  )

  const projects = Array.isArray(data.projects) ? data.projects : []
  return projects
    .filter((project) => typeof project?.gid === 'string' && project.gid)
    .map((project) => {
      const gid = project!.gid!.trim()
      const name =
        (project!.name && project!.name!.trim()) ||
        (gid.length > 0 ? gid : 'Project')
      return { gid, name }
    })
    .filter((project) => project.gid.length > 0)
}

export async function fetchAsanaTags(
  workspaceGid: string,
  options?: AsanaConnectionOptions
): Promise<AsanaTag[]> {
  if (!workspaceGid.trim()) return []

  const encodedWorkspace = encodeURIComponent(workspaceGid.trim())
  const data = await requestJson<TagsApiResponse>(
    appendConnectionQuery(
      `/api/asana/workspaces/${encodedWorkspace}/tags`,
      options
    ),
    'Asana tags'
  )

  const tags = Array.isArray(data.tags) ? data.tags : []
  return tags
    .filter((tag) => typeof tag?.gid === 'string' && tag.gid)
    .map((tag) => {
      const gid = tag!.gid!.trim()
      const name =
        (tag!.name && tag!.name!.trim()) || (gid.length > 0 ? gid : 'Tag')
      return { gid, name }
    })
    .filter((tag) => tag.gid.length > 0)
}

export async function fetchAsanaSections(
  projectGid: string,
  options?: AsanaConnectionOptions
): Promise<AsanaSection[]> {
  if (!projectGid.trim()) return []

  const encodedProject = encodeURIComponent(projectGid.trim())
  const data = await requestJson<SectionsApiResponse>(
    appendConnectionQuery(
      `/api/asana/projects/${encodedProject}/sections`,
      options
    ),
    'Asana sections'
  )

  const sections = Array.isArray(data.sections) ? data.sections : []
  return sections
    .filter((section) => typeof section?.gid === 'string' && section.gid)
    .map((section) => {
      const gid = section!.gid!.trim()
      const name =
        (section!.name && section!.name!.trim()) ||
        (gid.length > 0 ? gid : 'Section')
      return { gid, name }
    })
    .filter((section) => section.gid.length > 0)
}

export async function fetchAsanaTeams(
  workspaceGid: string,
  options?: AsanaConnectionOptions
): Promise<AsanaTeam[]> {
  if (!workspaceGid.trim()) return []

  const encodedWorkspace = encodeURIComponent(workspaceGid.trim())
  const data = await requestJson<TeamsApiResponse>(
    appendConnectionQuery(
      `/api/asana/workspaces/${encodedWorkspace}/teams`,
      options
    ),
    'Asana teams'
  )

  const teams = Array.isArray(data.teams) ? data.teams : []
  return teams
    .filter((team) => typeof team?.gid === 'string' && team.gid)
    .map((team) => {
      const gid = team!.gid!.trim()
      const name =
        (team!.name && team!.name!.trim()) || (gid.length > 0 ? gid : 'Team')
      return { gid, name }
    })
    .filter((team) => team.gid.length > 0)
}

export async function fetchAsanaUsers(
  workspaceGid: string,
  options?: AsanaConnectionOptions,
  teamGid?: string
): Promise<AsanaUser[]> {
  if (!workspaceGid.trim()) return []

  const encodedWorkspace = encodeURIComponent(workspaceGid.trim())
  const data = await requestJson<UsersApiResponse>(
    appendConnectionQuery(
      `/api/asana/workspaces/${encodedWorkspace}/users`,
      options,
      { team_gid: teamGid }
    ),
    'Asana users'
  )

  const users = Array.isArray(data.users) ? data.users : []
  return users
    .filter((user) => typeof user?.gid === 'string' && user.gid)
    .map((user) => {
      const gid = user!.gid!.trim()
      const name =
        (user!.name && user!.name!.trim()) || (gid.length > 0 ? gid : 'User')
      const email = user!.email?.trim()
      return { gid, name, email: email || undefined }
    })
    .filter((user) => user.gid.length > 0)
}

export async function fetchAsanaTasks(
  workspaceGid: string,
  options?: AsanaConnectionOptions,
  projectGid?: string
): Promise<AsanaTask[]> {
  if (!workspaceGid.trim()) return []

  const encodedWorkspace = encodeURIComponent(workspaceGid.trim())
  const data = await requestJson<TasksApiResponse>(
    appendConnectionQuery(
      `/api/asana/workspaces/${encodedWorkspace}/tasks`,
      options,
      { project_gid: projectGid }
    ),
    'Asana tasks'
  )

  const tasks = Array.isArray(data.tasks) ? data.tasks : []
  return tasks
    .filter((t) => t && typeof t.gid === 'string' && t.gid.trim())
    .map((t) => ({
      gid: t.gid.trim(),
      name: (t.name && t.name.trim()) || t.gid.trim(),
      notes: t.notes ?? '',
      due_on: t.due_on ?? null,
      due_at: t.due_at ?? null,
      completed: t.completed ?? false,
      assignee: t.assignee
        ? {
            gid: t.assignee.gid ?? '',
            name: t.assignee.name ?? '',
            email: t.assignee.email ?? null
          }
        : null,
      custom_fields: Array.isArray(t.custom_fields)
        ? t.custom_fields.map((cf) => ({
            gid: cf.gid ?? '',
            name: cf.name ?? '',
            type: cf.type ?? '',
            text_value: cf.text_value ?? null,
            number_value: cf.number_value ?? null,
            enum_value: cf.enum_value
              ? { name: cf.enum_value.name ?? '' }
              : null
          }))
        : []
    }))
    .filter((task) => task.gid.length > 0)
}

export async function fetchAsanaTaskDetails(
  taskGid: string,
  options?: AsanaConnectionOptions
): Promise<AsanaTask> {
  const task = encodeURIComponent(taskGid.trim())
  const data = await requestJson<TaskDetailsApiResponse & Partial<AsanaTask>>(
    appendConnectionQuery(`/api/asana/tasks/${task}`, options),
    'Asana task details'
  )

  const rawTask = (data as TaskDetailsApiResponse).task ?? data
  if (!rawTask || typeof rawTask.gid !== 'string') {
    throw new Error('Asana task details missing task payload')
  }

  const normalizeAssignee = (assignee: AsanaTask['assignee']) =>
    assignee
      ? {
          gid: assignee.gid ?? '',
          name: assignee.name ?? '',
          email: assignee.email ?? null
        }
      : null

  const normalizeCustomFields = (
    customFields: AsanaTask['custom_fields']
  ): AsanaTask['custom_fields'] =>
    Array.isArray(customFields)
      ? customFields.map((cf) => ({
          gid: cf.gid ?? '',
          name: cf.name ?? '',
          type: cf.type ?? '',
          text_value: cf.text_value ?? null,
          number_value: cf.number_value ?? null,
          enum_value: cf.enum_value ? { name: cf.enum_value.name ?? '' } : null
        }))
      : []

  return {
    gid: rawTask.gid.trim(),
    name: rawTask.name ?? rawTask.gid.trim(),
    notes: rawTask.notes ?? '',
    due_on: rawTask.due_on ?? null,
    due_at: rawTask.due_at ?? null,
    completed: rawTask.completed ?? false,
    assignee: normalizeAssignee(rawTask.assignee),
    custom_fields: normalizeCustomFields(rawTask.custom_fields)
  }
}

export async function fetchAsanaStories(
  taskGid: string,
  options?: AsanaConnectionOptions
): Promise<AsanaStory[]> {
  if (!taskGid.trim()) return []

  const encodedTask = encodeURIComponent(taskGid.trim())
  const data = await requestJson<StoriesApiResponse>(
    appendConnectionQuery(`/api/asana/tasks/${encodedTask}/stories`, options),
    'Asana comments'
  )

  const stories = Array.isArray(data.stories) ? data.stories : []
  return stories
    .filter((story) => typeof story?.gid === 'string' && story.gid)
    .map((story) => {
      const gid = story!.gid!.trim()
      const text =
        (story!.text && story!.text!.trim()) ||
        (gid.length > 0 ? gid : 'Comment')
      return { gid, text }
    })
    .filter((story) => story.gid.length > 0)
}

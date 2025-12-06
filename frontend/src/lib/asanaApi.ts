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

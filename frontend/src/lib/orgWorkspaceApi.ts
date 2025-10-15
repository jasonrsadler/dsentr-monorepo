import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export type WorkspaceMember = {
  workspace_id: string
  user_id: string
  role: 'owner' | 'admin' | 'user' | 'viewer'
  joined_at: string
}

export type Team = {
  id: string
  workspace_id: string
  name: string
  created_at: string
  updated_at: string
}

export async function listWorkspaceMembers(workspaceId: string) {
  const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/members`, {
    credentials: 'include'
  })
  const body = await res.json()
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to list members')
  return (body.members ?? []) as WorkspaceMember[]
}

export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'admin' | 'user' | 'viewer'
) {
  const csrf = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ user_id: userId, role })
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to add member')
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberId: string,
  role: 'owner' | 'admin' | 'user' | 'viewer'
) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/members/${memberId}`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ role })
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to update role')
}

export async function removeWorkspaceMember(workspaceId: string, memberId: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/members/${memberId}`,
    { method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrf } }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to remove')
}

export async function listTeams(workspaceId: string) {
  const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/teams`, {
    credentials: 'include'
  })
  const body = await res.json()
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to list teams')
  return (body.teams ?? []) as Team[]
}

export async function createTeam(workspaceId: string, name: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/teams`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ name })
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to create team')
  return body.team as Team
}

export async function deleteTeam(workspaceId: string, teamId: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/teams/${teamId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-csrf-token': csrf }
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to delete team')
}

export async function listTeamMembers(workspaceId: string, teamId: string) {
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/teams/${teamId}/members`,
    { credentials: 'include' }
  )
  const body = await res.json()
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to list team members')
  return (body.members ?? []) as { team_id: string; user_id: string; added_at: string }[]
}

export async function addTeamMember(workspaceId: string, teamId: string, userId: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/teams/${teamId}/members`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ user_id: userId })
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to add team member')
}

export async function removeTeamMember(
  workspaceId: string,
  teamId: string,
  userId: string
) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/teams/${teamId}/members/${userId}`,
    { method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrf } }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to remove team member')
}

export async function orgDowngradePreview(
  organizationId: string,
  targetWorkspaceId: string
) {
  const csrf = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workspaces/plan/downgrade-preview`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ organization_id: organizationId, target_workspace_id: targetWorkspaceId })
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to preview downgrade')
  return body as {
    target_workspace: any
    teams: Team[]
    will_disable_users: string[]
  }
}

export async function orgDowngradeExecute(
  organizationId: string,
  targetWorkspaceId: string,
  transfers: { user_id: string; team_id?: string | null }[]
) {
  const csrf = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workspaces/plan/downgrade-execute`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ organization_id: organizationId, target_workspace_id: targetWorkspaceId, transfers })
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to execute downgrade')
}

export async function workspaceToSoloPreview(workspaceId: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/plan/workspace-to-solo-preview`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ workspace_id: workspaceId })
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to preview downgrade')
  return (body?.will_disable_users ?? []) as string[]
}

export async function workspaceToSoloExecute(workspaceId: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/plan/workspace-to-solo-execute`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ workspace_id: workspaceId })
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to execute downgrade')
}


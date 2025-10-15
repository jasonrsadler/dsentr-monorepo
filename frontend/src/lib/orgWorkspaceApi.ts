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

export type WorkspaceInvitation = {
  id: string
  workspace_id: string
  team_id?: string | null
  email: string
  role: 'owner' | 'admin' | 'user' | 'viewer'
  token: string
  expires_at: string
  created_by: string
  created_at: string
  accepted_at?: string | null
  revoked_at?: string | null
}

export type TeamInviteLink = {
  id: string
  workspace_id: string
  team_id: string
  token: string
  created_by: string
  created_at: string
  expires_at?: string | null
  max_uses?: number | null
  used_count: number
  allowed_domain?: string | null
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

// Invitations (email-based)
export async function createWorkspaceInvite(
  workspaceId: string,
  payload: { email: string; role: WorkspaceMember['role']; team_id?: string | null; expires_in_days?: number }
) {
  const csrf = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify(payload)
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to create invitation')
  return body.invitation as WorkspaceInvitation
}

export async function listWorkspaceInvites(workspaceId: string) {
  const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/invites`, { credentials: 'include' })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to list invitations')
  return (body.invitations ?? []) as WorkspaceInvitation[]
}

export async function revokeWorkspaceInvite(workspaceId: string, inviteId: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/invites/${inviteId}/revoke`,
    { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrf } }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to revoke invitation')
}

// Join links
export async function listTeamInviteLinks(workspaceId: string, teamId: string) {
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/teams/${teamId}/invite-links`,
    { credentials: 'include' }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to list links')
  return (body.links ?? []) as TeamInviteLink[]
}

export async function createTeamInviteLink(
  workspaceId: string,
  teamId: string,
  payload: { expires_in_days?: number; max_uses?: number; allowed_domain?: string }
) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/teams/${teamId}/invite-links`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(payload)
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to create link')
  return body.link as TeamInviteLink
}

export async function revokeTeamInviteLink(workspaceId: string, teamId: string, linkId: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/teams/${teamId}/invite-links/${linkId}`,
    { method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrf } }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to revoke link')
}

export async function acceptInviteToken(token: string) {
  const res = await fetch(`${API_BASE_URL}/api/invites/${encodeURIComponent(token)}`, {
    method: 'POST',
    credentials: 'include'
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to accept invitation')
}

export async function acceptJoinToken(token: string) {
  const res = await fetch(`${API_BASE_URL}/api/join/${encodeURIComponent(token)}`, {
    method: 'POST',
    credentials: 'include'
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(body?.message || 'Failed to accept join link')
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

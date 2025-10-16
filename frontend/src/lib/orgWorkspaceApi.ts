import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export type WorkspaceMember = {
  workspace_id: string
  user_id: string
  role: 'owner' | 'admin' | 'user' | 'viewer'
  joined_at: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
}

export type WorkspaceInvitation = {
  id: string
  workspace_id: string
  email: string
  role: 'owner' | 'admin' | 'user' | 'viewer'
  token: string
  expires_at: string
  created_by: string
  created_at: string
  accepted_at?: string | null
  revoked_at?: string | null
  declined_at?: string | null
}

export type Workspace = {
  id: string
  name: string
  created_by: string
  created_at: string
  updated_at: string
}

export type WorkspaceMembershipSummary = {
  workspace: Workspace
  role: WorkspaceMember['role']
}

export async function listWorkspaces() {
  const res = await fetch(`${API_BASE_URL}/api/workspaces`, {
    credentials: 'include'
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to load workspaces')
  return (body.workspaces ?? []) as WorkspaceMembershipSummary[]
}

export async function listWorkspaceMembers(workspaceId: string) {
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/members`,
    {
      credentials: 'include'
    }
  )
  const body = await res.json()
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to list members')
  return (body.members ?? []) as WorkspaceMember[]
}

export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'admin' | 'user' | 'viewer'
) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/members`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ user_id: userId, role })
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to add member')
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

export async function removeWorkspaceMember(
  workspaceId: string,
  memberId: string
) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/members/${memberId}`,
    {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-csrf-token': csrf }
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to remove member')
}

export async function revokeWorkspaceMember(
  workspaceId: string,
  memberId: string,
  payload?: { reason?: string }
) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/revoke`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ member_id: memberId, reason: payload?.reason })
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to revoke member')
}

export async function leaveWorkspace(workspaceId: string) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/leave`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': csrf }
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to leave workspace')
}

export async function createWorkspaceInvite(
  workspaceId: string,
  payload: {
    email: string
    role: WorkspaceMember['role']
    expires_in_days?: number
  }
) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/invites`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(payload)
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to create invitation')
  return body.invitation as WorkspaceInvitation
}

export async function listWorkspaceInvites(workspaceId: string) {
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/invites`,
    { credentials: 'include' }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to list invitations')
  return (body.invitations ?? []) as WorkspaceInvitation[]
}

export async function listPendingInvites() {
  const res = await fetch(`${API_BASE_URL}/api/invites`, {
    credentials: 'include'
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to load invitations')
  return (body.invitations ?? []) as WorkspaceInvitation[]
}

export async function revokeWorkspaceInvite(
  workspaceId: string,
  inviteId: string
) {
  const csrf = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/invites/${inviteId}/revoke`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': csrf }
    }
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false)
    throw new Error(body?.message || 'Failed to revoke invitation')
}

async function postInviteDecision(
  path: string,
  token: string,
  errorMessage: string
) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) {
    throw new Error(body?.message || errorMessage)
  }
  return body
}

export async function acceptInviteToken(token: string) {
  return postInviteDecision(
    '/api/invites/accept',
    token,
    'Failed to accept invitation'
  )
}

export async function declineInviteToken(token: string) {
  return postInviteDecision(
    '/api/invites/decline',
    token,
    'Failed to decline invitation'
  )
}

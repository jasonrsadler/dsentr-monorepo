import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/stores/auth'
import {
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  createWorkspaceInvite,
  listWorkspaceInvites,
  revokeWorkspaceInvite,
  leaveWorkspace,
  HttpError,
  type WorkspaceMember,
  type WorkspaceInvitation,
  type WorkspaceMembershipSummary
} from '@/lib/orgWorkspaceApi'
import { normalizePlanTier } from '@/lib/planTiers'

const resolveMemberIdentity = (member: WorkspaceMember) => {
  const firstName = member.first_name?.trim() ?? ''
  const lastName = member.last_name?.trim() ?? ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const email = member.email?.trim() ?? ''
  const primary = fullName || email || member.user_id
  const secondary = fullName && email ? email : undefined
  const identifier = primary !== member.user_id ? member.user_id : undefined
  return { primary, secondary, identifier }
}

export default function MembersTab() {
  const memberships = useAuth((state) => state.memberships)
  const user = useAuth((state) => state.user)
  const checkAuth = useAuth((state) => state.checkAuth)
  const currentWorkspaceId = useAuth((state) => state.currentWorkspaceId)
  const setCurrentWorkspaceId = useAuth((state) => state.setCurrentWorkspaceId)
  const refreshMemberships = useAuth((state) => state.refreshMemberships)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'user' | 'viewer'>(
    'user'
  )
  const [inviteExpires, setInviteExpires] = useState<number>(14)
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvitation[]>(
    []
  )

  const planTier = useMemo(() => normalizePlanTier(user?.plan), [user?.plan])
  const availableWorkspaces = useMemo(
    () => (Array.isArray(memberships) ? memberships : []),
    [memberships]
  )
  const currentWorkspace = useMemo(() => {
    if (availableWorkspaces.length === 0) return null
    if (!currentWorkspaceId) {
      return availableWorkspaces[0] ?? null
    }
    return (
      availableWorkspaces.find(
        (membership) => membership.workspace.id === currentWorkspaceId
      ) ??
      availableWorkspaces[0] ??
      null
    )
  }, [availableWorkspaces, currentWorkspaceId])

  const resolvedWorkspaceId = currentWorkspace?.workspace?.id ?? null
  const resolvedWorkspaceName = currentWorkspace?.workspace?.name ?? ''
  const isWorkspaceOwner = currentWorkspace?.role === 'owner'
  const canManageMembers =
    planTier === 'workspace' && Boolean(resolvedWorkspaceId)
  const canLeaveWorkspace = Boolean(resolvedWorkspaceId) && !isWorkspaceOwner

  useEffect(() => {
    if (!currentWorkspaceId && availableWorkspaces[0]) {
      setCurrentWorkspaceId(availableWorkspaces[0].workspace.id)
    }
  }, [availableWorkspaces, currentWorkspaceId, setCurrentWorkspaceId])

  useEffect(() => {
    if (!resolvedWorkspaceId) {
      setMembers([])
      setPendingInvites([])
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    Promise.all([
      listWorkspaceMembers(resolvedWorkspaceId),
      listWorkspaceInvites(resolvedWorkspaceId)
    ])
      .then(([m, inv]) => {
        setMembers(m)
        setPendingInvites(inv)
      })
      .catch(async (error: unknown) => {
        if (error instanceof HttpError && error.status === 403) {
          setMembers([])
          setPendingInvites([])
          setError(null)
          const membershipsList = await refreshMemberships().catch(() => [])
          let fallbackWorkspace: WorkspaceMembershipSummary | null = null
          let message =
            'Access to this workspace was revoked. Redirected to your Solo workspace.'
          if (Array.isArray(membershipsList) && membershipsList.length > 0) {
            const soloWorkspace = membershipsList.find((membership) => {
              return membership.workspace.plan === 'solo'
            })
            if (soloWorkspace) {
              fallbackWorkspace = soloWorkspace
              message =
                'Access to this workspace was revoked. Redirected to your Solo workspace.'
            } else {
              fallbackWorkspace = membershipsList[0]
              message =
                'Access to this workspace was revoked. Switched to your next available workspace.'
            }
          } else {
            message =
              'Access to this workspace was revoked and no other workspaces are available.'
          }
          if (fallbackWorkspace) {
            setCurrentWorkspaceId(fallbackWorkspace.workspace.id)
          }
          setNotice(message)
          await checkAuth({ silent: true }).catch(() => null)
          return
        }
        const message =
          error instanceof Error ? error.message : 'Failed to load members'
        setError(message)
      })
      .finally(() => setBusy(false))
  }, [
    checkAuth,
    refreshMemberships,
    resolvedWorkspaceId,
    setCurrentWorkspaceId
  ])

  const handleWorkspaceSelect = useCallback(
    (workspaceId: string) => {
      if (!workspaceId || workspaceId === resolvedWorkspaceId) return
      setCurrentWorkspaceId(workspaceId)
    },
    [resolvedWorkspaceId, setCurrentWorkspaceId]
  )

  const handleInvite = async () => {
    if (!resolvedWorkspaceId || !inviteEmail.trim() || !canManageMembers) return
    try {
      setBusy(true)
      setError(null)
      const inv = await createWorkspaceInvite(resolvedWorkspaceId, {
        email: inviteEmail.trim(),
        role: inviteRole,
        expires_in_days: inviteExpires
      })
      setPendingInvites((prev) => [inv, ...prev])
      setInviteEmail('')
      setInviteRole('user')
    } catch (e: any) {
      setError(e.message || 'Failed to create invitation')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (uid: string) => {
    if (!resolvedWorkspaceId || !canManageMembers) return
    try {
      setBusy(true)
      await removeWorkspaceMember(resolvedWorkspaceId, uid)
      setMembers((prev) => prev.filter((m) => m.user_id !== uid))
    } catch (e: any) {
      setError(e.message || 'Failed to remove member')
    } finally {
      setBusy(false)
    }
  }

  const handleRole = async (uid: string, role: WorkspaceMember['role']) => {
    if (!resolvedWorkspaceId || !canManageMembers) return
    try {
      setBusy(true)
      setError(null)
      await updateWorkspaceMemberRole(resolvedWorkspaceId, uid, role)
      setMembers((prev) => {
        const previous = prev.find((m) => m.user_id === uid)
        if (!previous) return prev
        if (role === 'owner') {
          return prev.map((m) => {
            if (m.user_id === uid) {
              return { ...m, role }
            }
            if (m.role === 'owner') {
              return { ...m, role: 'admin' }
            }
            if (user && m.user_id === user.id && m.role === 'owner') {
              return { ...m, role: 'admin' }
            }
            return m
          })
        }
        return prev.map((m) => (m.user_id === uid ? { ...m, role } : m))
      })
      if (role === 'owner') {
        await checkAuth({ silent: true }).catch(() => null)
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to update role')
    } finally {
      setBusy(false)
    }
  }

  const handleLeaveWorkspace = useCallback(async () => {
    if (!resolvedWorkspaceId || !canLeaveWorkspace) return
    try {
      setBusy(true)
      setError(null)
      setNotice(null)
      await leaveWorkspace(resolvedWorkspaceId)
      const membershipsList = await refreshMemberships().catch(() => [])
      let message = 'You left the workspace.'
      if (Array.isArray(membershipsList) && membershipsList.length > 0) {
        const soloWorkspace = membershipsList.find((membership) => {
          return membership.workspace.plan === 'solo'
        })
        const nextWorkspace = soloWorkspace ?? membershipsList[0]
        if (nextWorkspace) {
          setCurrentWorkspaceId(nextWorkspace.workspace.id)
          message = soloWorkspace
            ? 'You left the workspace. Redirected to your Solo workspace.'
            : 'You left the workspace. Switched to your next available workspace.'
        }
      }
      setNotice(message)
      await checkAuth({ silent: true }).catch(() => null)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message || 'Failed to leave workspace'
          : 'Failed to leave workspace'
      setError(message)
      setNotice(null)
    } finally {
      setBusy(false)
    }
  }, [
    canLeaveWorkspace,
    checkAuth,
    refreshMemberships,
    resolvedWorkspaceId,
    setCurrentWorkspaceId
  ])

  if (!resolvedWorkspaceId) {
    return (
      <div className="space-y-4">
        {planTier === 'solo' ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Upgrade to the workspace plan to invite additional members.
          </div>
        ) : (
          <div className="text-sm text-zinc-600 dark:text-zinc-300">
            Workspace details are still loading. Refresh the page if this
            persists.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-600 dark:text-zinc-300">
          Workspace:{' '}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {resolvedWorkspaceName || 'Unnamed workspace'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {availableWorkspaces.length > 1 ? (
            <select
              value={resolvedWorkspaceId}
              onChange={(event) => handleWorkspaceSelect(event.target.value)}
              className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 text-sm"
            >
              {availableWorkspaces.map((membership) => (
                <option
                  key={membership.workspace.id}
                  value={membership.workspace.id}
                >
                  {membership.workspace.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            onClick={handleLeaveWorkspace}
            disabled={!canLeaveWorkspace || busy}
            className="px-3 py-1 text-xs font-medium rounded border border-red-400 text-red-600 disabled:opacity-50"
          >
            Leave workspace
          </button>
        </div>
      </div>

      {planTier === 'solo' ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Upgrade to the workspace plan to invite additional members.
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-md border border-blue-300 bg-blue-50 p-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-sm">Invite by Email</label>
          <input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="name@example.com"
            disabled={!canManageMembers}
            className="mt-1 w-full px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-sm">Role</label>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as any)}
            disabled={!canManageMembers}
            className="mt-1 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 disabled:opacity-60"
          >
            <option value="user">User</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label className="block text-sm">Expires (days)</label>
          <input
            type="number"
            min={1}
            max={60}
            value={inviteExpires}
            onChange={(e) => setInviteExpires(Number(e.target.value))}
            disabled={!canManageMembers}
            className="mt-1 w-24 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 disabled:opacity-60"
          />
        </div>
        <button
          onClick={handleInvite}
          disabled={!canManageMembers || busy}
          className="h-9 px-3 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
        >
          Invite
        </button>
      </div>

      {pendingInvites.length > 0 && (
        <div className="border-t pt-3">
          <h4 className="font-semibold mb-2">Pending invitations</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-1">Email</th>
                <th className="py-1">Role</th>
                <th className="py-1">Expires</th>
                <th className="py-1 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-t border-zinc-200 dark:border-zinc-700"
                >
                  <td className="py-2">{inv.email}</td>
                  <td className="py-2 capitalize">{inv.role}</td>
                  <td className="py-2 text-xs">
                    {new Date(inv.expires_at).toLocaleString()}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={async () => {
                        if (!resolvedWorkspaceId) return
                        await revokeWorkspaceInvite(resolvedWorkspaceId, inv.id)
                        setPendingInvites((prev) =>
                          prev.filter((i) => i.id !== inv.id)
                        )
                      }}
                      disabled={!canManageMembers}
                      className="px-2 py-1 text-xs rounded border disabled:opacity-60"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t pt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2">Member</th>
              <th className="py-2">Role</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const baseRoles: WorkspaceMember['role'][] = [
                'viewer',
                'user',
                'admin'
              ]
              const roleOptions =
                isWorkspaceOwner || m.role === 'owner'
                  ? [...baseRoles, 'owner' as WorkspaceMember['role']]
                  : baseRoles
              const disableSelect =
                busy || !canManageMembers || m.role === 'owner'
              const disableRemove =
                busy || !canManageMembers || m.role === 'owner'
              const identity = resolveMemberIdentity(m)
              return (
                <tr
                  key={m.user_id}
                  className="border-t border-zinc-200 dark:border-zinc-700"
                >
                  <td className="py-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {identity.primary}
                      </span>
                      {identity.secondary && (
                        <span className="text-xs text-zinc-500">
                          {identity.secondary}
                        </span>
                      )}
                      {identity.identifier && (
                        <span className="text-[11px] font-mono text-zinc-500 break-all">
                          {identity.identifier}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2">
                    <select
                      value={m.role}
                      onChange={(e) =>
                        handleRole(
                          m.user_id,
                          e.target.value as WorkspaceMember['role']
                        )
                      }
                      disabled={disableSelect}
                      className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700 disabled:opacity-60"
                    >
                      {roleOptions.map((option) => (
                        <option key={option} value={option}>
                          {option.charAt(0).toUpperCase() + option.slice(1)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleRemove(m.user_id)}
                      disabled={disableRemove}
                      className="px-2 py-1 text-xs rounded border text-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-zinc-500">
                  {busy ? 'Loading...' : 'No members yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

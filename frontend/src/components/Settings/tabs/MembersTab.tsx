import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/stores/auth'
import {
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  createWorkspaceInvite,
  listWorkspaceInvites,
  revokeWorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceInvitation
} from '@/lib/orgWorkspaceApi'
import { normalizePlanTier } from '@/lib/planTiers'

export default function MembersTab() {
  const { memberships, user, checkAuth } = useAuth()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    if (!workspaceId) return availableWorkspaces[0] ?? null
    return (
      availableWorkspaces.find((m) => m.workspace.id === workspaceId) ?? null
    )
  }, [availableWorkspaces, workspaceId])

  const resolvedWorkspaceId = currentWorkspace?.workspace?.id ?? null
  const resolvedWorkspaceName = currentWorkspace?.workspace?.name ?? ''
  const isWorkspaceOwner = currentWorkspace?.role === 'owner'
  const canManageMembers =
    planTier === 'workspace' && Boolean(resolvedWorkspaceId)

  useEffect(() => {
    if (!workspaceId && availableWorkspaces[0]) {
      setWorkspaceId(availableWorkspaces[0].workspace.id)
    }
  }, [workspaceId, availableWorkspaces])

  useEffect(() => {
    if (!resolvedWorkspaceId) {
      setMembers([])
      setPendingInvites([])
      return
    }
    setBusy(true)
    setError(null)
    Promise.all([
      listWorkspaceMembers(resolvedWorkspaceId),
      listWorkspaceInvites(resolvedWorkspaceId)
    ])
      .then(([m, inv]) => {
        setMembers(m)
        setPendingInvites(inv)
      })
      .catch((e) => setError(e.message || 'Failed to load members'))
      .finally(() => setBusy(false))
  }, [resolvedWorkspaceId])

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
        {availableWorkspaces.length > 1 ? (
          <select
            value={resolvedWorkspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
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
      </div>

      {planTier === 'solo' ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Upgrade to the workspace plan to invite additional members.
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
              <th className="py-2">User</th>
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
              return (
                <tr
                  key={m.user_id}
                  className="border-t border-zinc-200 dark:border-zinc-700"
                >
                  <td className="py-2 font-mono text-xs">{m.user_id}</td>
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

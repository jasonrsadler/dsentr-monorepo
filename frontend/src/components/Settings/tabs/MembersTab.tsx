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
  type WorkspaceInvitation,
} from '@/lib/orgWorkspaceApi'

export default function MembersTab() {
  const { memberships } = useAuth()
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'owner' | 'admin' | 'user' | 'viewer'>('user')
  const [inviteTeamId, setInviteTeamId] = useState<string | ''>('')
  const [inviteExpires, setInviteExpires] = useState<number>(14)
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvitation[]>([])

  const workspaceOptions = useMemo(
    () => (Array.isArray(memberships) ? memberships.map((m) => m.workspace) : []),
    [memberships]
  )

  useEffect(() => {
    if (!workspaceId && workspaceOptions[0]) setWorkspaceId(workspaceOptions[0].id)
  }, [workspaceId, workspaceOptions])

  useEffect(() => {
    if (!workspaceId) return
    setBusy(true)
    setError(null)
    Promise.all([
      listWorkspaceMembers(workspaceId),
      listWorkspaceInvites(workspaceId),
      (async () => {
        try {
          const res = await import('@/lib/orgWorkspaceApi')
          const list = await res.listTeams(workspaceId)
          return list
        } catch {
          return []
        }
      })()
    ])
      .then(([m, inv, t]) => {
        setMembers(m)
        setPendingInvites(inv)
        setTeams(t)
      })
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setBusy(false))
  }, [workspaceId])

  const handleInvite = async () => {
    if (!workspaceId || !inviteEmail.trim()) return
    try {
      setBusy(true)
      setError(null)
      const inv = await createWorkspaceInvite(workspaceId, {
        email: inviteEmail.trim(),
        role: inviteRole,
        team_id: inviteTeamId || undefined,
        expires_in_days: inviteExpires
      })
      setPendingInvites((prev) => [inv, ...prev])
      setInviteEmail('')
      setInviteRole('user')
      setInviteTeamId('')
    } catch (e: any) {
      setError(e.message || 'Failed to create invitation')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (uid: string) => {
    if (!workspaceId) return
    try {
      setBusy(true)
      await removeWorkspaceMember(workspaceId, uid)
      setMembers((prev) => prev.filter((m) => m.user_id !== uid))
    } catch (e: any) {
      setError(e.message || 'Failed to remove')
    } finally {
      setBusy(false)
    }
  }

  const handleRole = async (uid: string, role: WorkspaceMember['role']) => {
    if (!workspaceId) return
    try {
      setBusy(true)
      await updateWorkspaceMemberRole(workspaceId, uid, role)
      setMembers((prev) => prev.map((m) => (m.user_id === uid ? { ...m, role } : m)))
    } catch (e: any) {
      setError(e.message || 'Failed to update role')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm">Workspace</label>
        <select
          value={workspaceId ?? ''}
          onChange={(e) => setWorkspaceId(e.target.value || null)}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
        >
          {workspaceOptions.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

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
            className="mt-1 w-full px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
          />
        </div>
        <div>
          <label className="block text-sm">Role</label>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as any)}
            className="mt-1 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
          >
            <option value="user">User</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div>
          <label className="block text-sm">Team (optional)</label>
          <select
            value={inviteTeamId}
            onChange={(e) => setInviteTeamId(e.target.value)}
            className="mt-1 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
          >
            <option value="">—</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
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
            className="mt-1 w-24 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
          />
        </div>
        <button
          onClick={handleInvite}
          disabled={busy}
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
                <tr key={inv.id} className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="py-2">{inv.email}</td>
                  <td className="py-2 capitalize">{inv.role}</td>
                  <td className="py-2 text-xs">{new Date(inv.expires_at).toLocaleString()}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={async () => {
                        if (!workspaceId) return
                        await revokeWorkspaceInvite(workspaceId, inv.id)
                        setPendingInvites((prev) => prev.filter((i) => i.id !== inv.id))
                      }}
                      className="px-2 py-1 text-xs rounded border"
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
            {members.map((m) => (
              <tr key={m.user_id} className="border-t border-zinc-200 dark:border-zinc-700">
                <td className="py-2 font-mono text-xs">{m.user_id}</td>
                <td className="py-2">
                  <select
                    value={m.role}
                    onChange={(e) => handleRole(m.user_id, e.target.value as any)}
                    className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => handleRemove(m.user_id)}
                    className="px-2 py-1 text-xs rounded border text-red-600"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
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

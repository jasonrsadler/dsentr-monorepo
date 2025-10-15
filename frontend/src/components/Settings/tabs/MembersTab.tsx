import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/stores/auth'
import {
  addWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  type WorkspaceMember
} from '@/lib/orgWorkspaceApi'

export default function MembersTab() {
  const { memberships } = useAuth()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUserId, setInviteUserId] = useState('')
  const [inviteRole, setInviteRole] = useState<'owner' | 'admin' | 'user' | 'viewer'>('user')

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
    listWorkspaceMembers(workspaceId)
      .then(setMembers)
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setBusy(false))
  }, [workspaceId])

  const handleInvite = async () => {
    if (!workspaceId || !inviteUserId.trim()) return
    try {
      setBusy(true)
      setError(null)
      await addWorkspaceMember(workspaceId, inviteUserId.trim(), inviteRole)
      const next = await listWorkspaceMembers(workspaceId)
      setMembers(next)
      setInviteUserId('')
      setInviteRole('user')
    } catch (e: any) {
      setError(e.message || 'Failed to invite user')
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
          <label className="block text-sm">Invite by User ID</label>
          <input
            value={inviteUserId}
            onChange={(e) => setInviteUserId(e.target.value)}
            placeholder="UUID of user"
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
        <button
          onClick={handleInvite}
          disabled={busy}
          className="h-9 px-3 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
        >
          Invite
        </button>
      </div>

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


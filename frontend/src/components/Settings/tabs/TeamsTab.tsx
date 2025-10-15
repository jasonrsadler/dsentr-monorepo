import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/stores/auth'
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  type Team
} from '@/lib/orgWorkspaceApi'

export default function TeamsTab() {
  const { memberships } = useAuth()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [members, setMembers] = useState<{ team_id: string; user_id: string; added_at: string }[]>([])
  const [newTeamName, setNewTeamName] = useState('')
  const [addUserId, setAddUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    listTeams(workspaceId)
      .then((list) => {
        setTeams(list)
        setSelectedTeamId(list[0]?.id ?? null)
      })
      .catch((e) => setError(e.message || 'Failed to load teams'))
      .finally(() => setBusy(false))
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || !selectedTeamId) {
      setMembers([])
      return
    }
    setBusy(true)
    setError(null)
    listTeamMembers(workspaceId, selectedTeamId)
      .then(setMembers)
      .catch((e) => setError(e.message || 'Failed to load members'))
      .finally(() => setBusy(false))
  }, [workspaceId, selectedTeamId])

  const handleCreateTeam = async () => {
    if (!workspaceId || !newTeamName.trim()) return
    try {
      setBusy(true)
      const t = await createTeam(workspaceId, newTeamName.trim())
      setTeams((prev) => [...prev, t])
      setNewTeamName('')
    } catch (e: any) {
      setError(e.message || 'Failed to create team')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteTeam = async () => {
    if (!workspaceId || !selectedTeamId) return
    try {
      setBusy(true)
      await deleteTeam(workspaceId, selectedTeamId)
      const next = teams.filter((t) => t.id !== selectedTeamId)
      setTeams(next)
      setSelectedTeamId(next[0]?.id ?? null)
    } catch (e: any) {
      setError(e.message || 'Failed to delete team')
    } finally {
      setBusy(false)
    }
  }

  const handleAddUser = async () => {
    if (!workspaceId || !selectedTeamId || !addUserId.trim()) return
    try {
      setBusy(true)
      await addTeamMember(workspaceId, selectedTeamId, addUserId.trim())
      const list = await listTeamMembers(workspaceId, selectedTeamId)
      setMembers(list)
      setAddUserId('')
    } catch (e: any) {
      setError(e.message || 'Failed to add user')
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveUser = async (uid: string) => {
    if (!workspaceId || !selectedTeamId) return
    try {
      setBusy(true)
      await removeTeamMember(workspaceId, selectedTeamId, uid)
      setMembers((prev) => prev.filter((m) => m.user_id !== uid))
    } catch (e: any) {
      setError(e.message || 'Failed to remove user')
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
          <label className="block text-sm">New team name</label>
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="mt-1 w-full px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
          />
        </div>
        <button
          onClick={handleCreateTeam}
          disabled={busy}
          className="h-9 px-3 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
        >
          Create
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm">Team</label>
        <select
          value={selectedTeamId ?? ''}
          onChange={(e) => setSelectedTeamId(e.target.value || null)}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleDeleteTeam}
          disabled={!selectedTeamId || busy}
          className="px-3 py-1 rounded border text-sm"
        >
          Delete team
        </button>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-sm">Add user (by User ID)</label>
          <input
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            className="mt-1 w-full px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
          />
        </div>
        <button
          onClick={handleAddUser}
          disabled={!selectedTeamId || busy}
          className="h-9 px-3 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
        >
          Add
        </button>
      </div>

      <div className="border-t pt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2">User</th>
              <th className="py-2 text-right"></th>
            </tr>
          </thead>
        </table>
        <div>
          {members.length === 0 ? (
            <div className="py-4 text-center text-zinc-500">
              {busy ? 'Loading...' : 'No team members.'}
            </div>
          ) : (
            <ul>
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between py-2 border-t border-zinc-200 dark:border-zinc-700">
                  <span className="font-mono text-xs">{m.user_id}</span>
                  <button
                    onClick={() => handleRemoveUser(m.user_id)}
                    className="px-2 py-1 text-xs rounded border text-red-600"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}


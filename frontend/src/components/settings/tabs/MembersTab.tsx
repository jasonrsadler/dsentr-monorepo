import { useCallback, useEffect, useMemo, useState } from 'react'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
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
import {
  fetchWorkspaceSecretOwnership,
  type WorkspaceSecretOwnershipEntry
} from '@/lib/optionsApi'
import { useSecrets } from '@/contexts/SecretsContext'
import { usePlanUsageStore } from '@/stores/planUsageStore'
import { QuotaBanner } from '@/components/quota/QuotaBanner'

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

const filterPendingInvitations = (
  invites: WorkspaceInvitation[]
): WorkspaceInvitation[] =>
  invites.filter((invite) => invite.status === 'pending')

export default function MembersTab() {
  const user = useAuth((state) => state.user)
  const checkAuth = useAuth((state) => state.checkAuth)
  const setCurrentWorkspaceId = useAuth((state) => state.setCurrentWorkspaceId)
  const refreshMemberships = useAuth((state) => state.refreshMemberships)
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const memberships = useAuth((state) => state.memberships)
  const { refresh: refreshSecrets } = useSecrets()
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
  const [checkingOwnershipFor, setCheckingOwnershipFor] = useState<
    string | null
  >(null)
  const [pendingRemoval, setPendingRemoval] = useState<{
    member: WorkspaceMember
    secrets: WorkspaceSecretOwnershipEntry[]
  } | null>(null)

  const planTier = useMemo(
    () =>
      normalizePlanTier(
        currentWorkspace?.workspace.plan ?? user?.plan ?? undefined
      ),
    [currentWorkspace?.workspace.plan, user?.plan]
  )
  const resolvedWorkspaceId = currentWorkspace?.workspace?.id ?? null
  const resolvedWorkspaceName = currentWorkspace?.workspace?.name ?? ''
  const isWorkspaceOwner = currentWorkspace?.role === 'owner'
  const isWorkspaceAdminOrOwner =
    currentWorkspace?.role === 'admin' || currentWorkspace?.role === 'owner'
  const canManageMembers =
    planTier === 'workspace' &&
    Boolean(resolvedWorkspaceId) &&
    isWorkspaceAdminOrOwner
  const canLeaveWorkspace = Boolean(resolvedWorkspaceId) && !isWorkspaceOwner
  const manageMembersPermissionMessage =
    'Only workspace admins or owners can manage members.'
  const planUsage = usePlanUsageStore((state) => state.usage)
  const refreshPlanUsage = usePlanUsageStore((state) => state.refresh)
  const memberLimit = useMemo(() => {
    if (planUsage?.workspace?.members?.limit) {
      return planUsage.workspace.members.limit
    }
    return 8
  }, [planUsage?.workspace?.members?.limit])
  const memberUsage = useMemo(() => {
    if (planUsage?.workspace?.members?.used != null) {
      return planUsage.workspace.members.used
    }
    return members.length
  }, [planUsage?.workspace?.members?.used, members.length])
  const memberLimitReached =
    planTier === 'workspace' && memberUsage >= memberLimit
  const memberLimitApproaching =
    planTier === 'workspace' &&
    !memberLimitReached &&
    memberUsage >= Math.max(0, memberLimit - 1)
  const memberLimitMessage = `Workspace member limit reached. Remove a member to free a seat (${memberUsage}/${memberLimit}).`
  const canInviteMembers = canManageMembers && !memberLimitReached
  const openPlanSettings = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
    )
  }, [])
  useEffect(() => {
    if (planTier === 'workspace') {
      void refreshPlanUsage()
    }
  }, [planTier, refreshPlanUsage])

  useEffect(() => {
    if (!resolvedWorkspaceId) {
      setMembers([])
      setPendingInvites([])
      return
    }

    let active = true

    const loadWorkspaceData = async () => {
      setBusy(true)
      setError(null)
      setNotice(null)

      try {
        const loadedMembers = await listWorkspaceMembers(resolvedWorkspaceId)
        if (active) {
          setMembers(loadedMembers)
        }

        if (!isWorkspaceAdminOrOwner) {
          if (active) {
            setPendingInvites([])
          }
          return
        }

        try {
          const invites = await listWorkspaceInvites(resolvedWorkspaceId)
          if (active) {
            setPendingInvites(filterPendingInvitations(invites))
          }
        } catch (error) {
          if (!active) {
            return
          }
          if (error instanceof HttpError && error.status === 403) {
            setPendingInvites([])
          } else {
            const message =
              error instanceof Error
                ? error.message
                : 'Failed to load invitations'
            setError(message)
          }
        }
      } catch (error) {
        if (!active) {
          return
        }
        if (
          error instanceof HttpError &&
          (error.status === 403 || error.status === 404)
        ) {
          setMembers([])
          setPendingInvites([])
          setError(null)
          const membershipsList = await refreshMemberships().catch(() => [])
          let fallbackWorkspace: WorkspaceMembershipSummary | null = null
          let message =
            'Access to this workspace was revoked. Redirected to your Solo workspace.'
          if (Array.isArray(membershipsList) && membershipsList.length > 0) {
            const soloWorkspace = membershipsList.find((membership) => {
              return normalizePlanTier(membership.workspace.plan) === 'solo'
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
        } else {
          const message =
            error instanceof Error ? error.message : 'Failed to load members'
          setError(message)
        }
      } finally {
        if (active) {
          setBusy(false)
        }
      }
    }

    loadWorkspaceData()

    return () => {
      active = false
    }
  }, [
    checkAuth,
    isWorkspaceAdminOrOwner,
    refreshMemberships,
    resolvedWorkspaceId,
    setCurrentWorkspaceId
  ])

  const handleInvite = async () => {
    if (
      !resolvedWorkspaceId ||
      !inviteEmail.trim() ||
      !isWorkspaceAdminOrOwner ||
      memberLimitReached
    ) {
      if (memberLimitReached) {
        setError(memberLimitMessage)
      }
      return
    }
    try {
      setBusy(true)
      setError(null)
      const inv = await createWorkspaceInvite(resolvedWorkspaceId, {
        email: inviteEmail.trim(),
        role: inviteRole,
        expires_in_days: inviteExpires
      })
      setPendingInvites((prev) => filterPendingInvitations([inv, ...prev]))
      setInviteEmail('')
      setInviteRole('user')
      void refreshPlanUsage()
    } catch (e: any) {
      setError(e.message || 'Failed to create invitation')
    } finally {
      setBusy(false)
    }
  }

  const performMemberRemoval = useCallback(
    async (uid: string) => {
      if (!resolvedWorkspaceId || !isWorkspaceAdminOrOwner) return false
      try {
        setBusy(true)
        setError(null)
        await removeWorkspaceMember(resolvedWorkspaceId, uid)
        setMembers((prev) => prev.filter((m) => m.user_id !== uid))
        await refreshPlanUsage().catch(() => undefined)
        try {
          await refreshSecrets()
        } catch (err) {
          console.error('Failed to refresh secrets after member removal', err)
        }
        return true
      } catch (e: any) {
        setError(e?.message || 'Failed to remove member')
        return false
      } finally {
        setBusy(false)
      }
    },
    [isWorkspaceAdminOrOwner, refreshSecrets, resolvedWorkspaceId]
  )

  const handleRemove = useCallback(
    async (member: WorkspaceMember) => {
      if (!resolvedWorkspaceId || !isWorkspaceAdminOrOwner) return
      setError(null)
      setNotice(null)
      setCheckingOwnershipFor(member.user_id)
      try {
        const ownership =
          await fetchWorkspaceSecretOwnership(resolvedWorkspaceId)
        const secretsForMember = ownership?.[member.user_id] ?? []
        if (secretsForMember.length > 0) {
          setPendingRemoval({ member, secrets: secretsForMember })
          return
        }
        await performMemberRemoval(member.user_id)
      } catch (e: any) {
        const message =
          e instanceof Error
            ? e.message
            : 'Failed to check secret ownership for this member'
        setError(message)
      } finally {
        setCheckingOwnershipFor(null)
      }
    },
    [isWorkspaceAdminOrOwner, performMemberRemoval, resolvedWorkspaceId]
  )

  const applyRoleChange = useCallback(
    async (uid: string, role: WorkspaceMember['role']) => {
      if (!resolvedWorkspaceId || !isWorkspaceAdminOrOwner) return
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
              // Previous owner demotion handled above
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
    },
    [checkAuth, isWorkspaceAdminOrOwner, resolvedWorkspaceId]
  )

  const requestRoleChange = useCallback(
    (member: WorkspaceMember, role: WorkspaceMember['role']) => {
      void applyRoleChange(member.user_id, role)
    },
    [applyRoleChange]
  )

  const confirmPendingRemoval = useCallback(async () => {
    if (!pendingRemoval) return
    const success = await performMemberRemoval(pendingRemoval.member.user_id)
    if (success) {
      setPendingRemoval(null)
    }
  }, [pendingRemoval, performMemberRemoval])

  const cancelPendingRemoval = useCallback(() => {
    setPendingRemoval(null)
  }, [])

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
          return normalizePlanTier(membership.workspace.plan) === 'solo'
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
    <div className="relative">
      {pendingRemoval ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Confirm member removal
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Removing {resolveMemberIdentity(pendingRemoval.member).primary}{' '}
              will delete {pendingRemoval.secrets.length} secret
              {pendingRemoval.secrets.length === 1 ? '' : 's'} they created for
              this workspace. This action cannot be undone and workflows using
              these secrets may fail.
            </p>
            <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <p className="font-medium text-zinc-700 dark:text-zinc-200">
                Secrets owned by this member:
              </p>
              <ul className="mt-2 space-y-1">
                {pendingRemoval.secrets.slice(0, 5).map((secret) => (
                  <li key={`${secret.group}:${secret.service}:${secret.name}`}>
                    <span className="font-medium">{secret.name}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {' '}
                      ({secret.group} / {secret.service})
                    </span>
                  </li>
                ))}
              </ul>
              {pendingRemoval.secrets.length > 5 ? (
                <p className="mt-2 text-zinc-500 dark:text-zinc-400">
                  …and {pendingRemoval.secrets.length - 5} more entries.
                </p>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={cancelPendingRemoval}
                className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={confirmPendingRemoval}
                disabled={busy}
                className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Removing…' : 'Remove member'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
            <span>Workspace:</span>
            {Array.isArray(memberships) && memberships.length > 1 ? (
              <select
                aria-label="workspace switcher"
                value={resolvedWorkspaceId ?? ''}
                onChange={(e) => setCurrentWorkspaceId(e.target.value)}
                className="mt-0.5 rounded border px-2 py-1 bg-white dark:border-zinc-700 dark:bg-zinc-800"
              >
                {memberships.map((m) => (
                  <option key={m.workspace.id} value={m.workspace.id}>
                    {m.workspace.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {resolvedWorkspaceName || 'Unnamed workspace'}
              </span>
            )}
          </div>
          <button
            onClick={handleLeaveWorkspace}
            disabled={!canLeaveWorkspace || busy}
            className="rounded border border-red-400 px-3 py-1 text-xs font-medium text-red-600 disabled:opacity-50"
          >
            Leave workspace
          </button>
        </div>

        {planTier === 'solo' ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Upgrade to the workspace plan to invite additional members.
          </div>
        ) : null}
        {planTier === 'workspace' &&
        (memberLimitReached || memberLimitApproaching) ? (
          <QuotaBanner
            variant={memberLimitReached ? 'danger' : 'warning'}
            title={
              memberLimitReached
                ? 'Workspace member limit reached'
                : 'Workspace member limit nearly reached'
            }
            description={`Members: ${memberUsage} of ${memberLimit} seats in use.`}
            actionLabel="Manage plan"
            onAction={openPlanSettings}
          />
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

        {planTier === 'workspace' && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-sm">Invite by Email</label>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                disabled={!canInviteMembers}
                title={
                  !isWorkspaceAdminOrOwner
                    ? manageMembersPermissionMessage
                    : memberLimitReached
                      ? memberLimitMessage
                      : undefined
                }
                className="mt-1 w-full rounded border px-2 py-1 bg-white dark:border-zinc-700 dark:bg-zinc-800 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-sm">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as any)}
                disabled={!canInviteMembers}
                title={
                  !isWorkspaceAdminOrOwner
                    ? manageMembersPermissionMessage
                    : memberLimitReached
                      ? memberLimitMessage
                      : undefined
                }
                className="mt-1 rounded border px-2 py-1 bg-white dark:border-zinc-700 dark:bg-zinc-800 disabled:opacity-60"
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
                disabled={!canInviteMembers}
                title={
                  !isWorkspaceAdminOrOwner
                    ? manageMembersPermissionMessage
                    : memberLimitReached
                      ? memberLimitMessage
                      : undefined
                }
                className="mt-1 w-24 rounded border px-2 py-1 bg-white dark:border-zinc-700 dark:bg-zinc-800 disabled:opacity-60"
              />
            </div>
            <button
              onClick={handleInvite}
              disabled={!canInviteMembers || busy}
              title={
                !isWorkspaceAdminOrOwner
                  ? manageMembersPermissionMessage
                  : memberLimitReached
                    ? memberLimitMessage
                    : undefined
              }
              className="h-9 rounded bg-indigo-600 px-3 text-sm text-white disabled:opacity-50"
            >
              Invite
            </button>
          </div>
        )}

        {!isWorkspaceAdminOrOwner && planTier === 'workspace' ? (
          <p className="text-xs text-zinc-500">
            {manageMembersPermissionMessage}
          </p>
        ) : null}

        {pendingInvites.length > 0 && (
          <div className="border-t pt-3">
            <h4 className="mb-2 font-semibold">Pending invitations</h4>
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
                          if (!resolvedWorkspaceId || !isWorkspaceAdminOrOwner)
                            return
                          await revokeWorkspaceInvite(
                            resolvedWorkspaceId,
                            inv.id
                          )
                          setPendingInvites((prev) =>
                            prev.filter((i) => i.id !== inv.id)
                          )
                        }}
                        disabled={!canManageMembers}
                        title={
                          !isWorkspaceAdminOrOwner
                            ? manageMembersPermissionMessage
                            : undefined
                        }
                        className="rounded border px-2 py-1 text-xs disabled:opacity-60"
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
                  m.role === 'owner'
                    ? [...baseRoles, 'owner' as WorkspaceMember['role']]
                    : baseRoles
                const disableSelect =
                  busy ||
                  !canManageMembers ||
                  m.role === 'owner' ||
                  memberLimitReached
                const disableRemove =
                  busy ||
                  !canManageMembers ||
                  m.role === 'owner' ||
                  checkingOwnershipFor === m.user_id
                const verifyingRemoval = checkingOwnershipFor === m.user_id
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
                          requestRoleChange(
                            m,
                            e.target.value as WorkspaceMember['role']
                          )
                        }
                        disabled={disableSelect}
                        title={
                          !isWorkspaceAdminOrOwner && m.role !== 'owner'
                            ? manageMembersPermissionMessage
                            : memberLimitReached
                              ? memberLimitMessage
                              : undefined
                        }
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
                        onClick={() => handleRemove(m)}
                        disabled={disableRemove}
                        title={
                          !isWorkspaceAdminOrOwner && m.role !== 'owner'
                            ? manageMembersPermissionMessage
                            : undefined
                        }
                        className="px-2 py-1 text-xs rounded border text-red-600 disabled:opacity-50"
                      >
                        {verifyingRemoval
                          ? 'Checking…'
                          : busy && pendingRemoval?.member.user_id === m.user_id
                            ? 'Removing…'
                            : 'Remove'}
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
    </div>
  )
}

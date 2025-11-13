import { useCallback, useEffect, useMemo, useState } from 'react'

import { API_BASE_URL } from '@/lib/config'
import { errorMessage } from '@/lib/errorMessage'
import {
  OAuthProvider,
  ProviderConnectionSet,
  WorkspaceConnectionInfo,
  disconnectProvider,
  fetchConnections,
  refreshProvider,
  promoteConnection,
  unshareWorkspaceConnection,
  setCachedConnections,
  markProviderRevoked,
  type GroupedConnectionsSnapshot
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { normalizePlanTier, type PlanTier } from '@/lib/planTiers'
import ConfirmDialog from '@/components/ui/dialog/ConfirmDialog'

export type IntegrationNotice =
  | { kind: 'connected'; provider?: OAuthProvider }
  | { kind: 'error'; provider?: OAuthProvider; message?: string }

interface IntegrationsTabProps {
  notice?: IntegrationNotice | null
  onDismissNotice?: () => void
}

interface ProviderMeta {
  key: OAuthProvider
  name: string
  description: string
  scopes: string
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: 'google',
    name: 'Google',
    description:
      'Connect your Google Workspace account to enable actions that call Gmail, Calendar, and other Google APIs on your behalf.',
    scopes: 'openid email profile userinfo'
  },
  {
    key: 'microsoft',
    name: 'Microsoft',
    description:
      'Connect your Microsoft 365 account to run Outlook and Teams actions with delegated permissions managed by DSentr.',
    scopes: 'offline_access User.Read'
  },
  {
    key: 'slack',
    name: 'Slack',
    description:
      'Connect your Slack workspace to post messages, manage channels, and automate collaboration from DSentr workflows.',
    scopes: 'chat:write channels:read users:read'
  }
]

const emptyProviderState = (): ProviderConnectionSet => ({
  personal: {
    scope: 'personal',
    id: null,
    connected: false,
    accountEmail: undefined,
    expiresAt: undefined,
    lastRefreshedAt: undefined,
    requiresReconnect: false,
    isShared: false
  },
  workspace: []
})

// Provider state is derived on the fly from the grouped snapshot.

export default function IntegrationsTab({
  notice,
  onDismissNotice
}: IntegrationsTabProps) {
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const userPlan = useAuth((state) => state.user?.plan ?? null)
  const currentUser = useAuth((state) => state.user ?? null)
  const workspaceRole = currentWorkspace?.role ?? null
  const workspaceId = currentWorkspace?.workspace.id ?? null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connections, setConnections] =
    useState<GroupedConnectionsSnapshot | null>(null)
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null)
  const [promoteDialogProvider, setPromoteDialogProvider] =
    useState<OAuthProvider | null>(null)
  const [promoteBusyProvider, setPromoteBusyProvider] =
    useState<OAuthProvider | null>(null)
  const [removeDialog, setRemoveDialog] =
    useState<WorkspaceConnectionInfo | null>(null)
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null)
  const [disconnectDialog, setDisconnectDialog] = useState<{
    provider: OAuthProvider
    sharedConnections: WorkspaceConnectionInfo[]
  } | null>(null)

  const planTier = useMemo<PlanTier>((): PlanTier => {
    return normalizePlanTier(
      currentWorkspace?.workspace.plan ?? userPlan ?? undefined
    )
  }, [currentWorkspace?.workspace.plan, userPlan])
  const isSoloPlan = planTier === 'solo'
  const isViewer = workspaceRole === 'viewer'
  const canPromote = workspaceRole === 'owner' || workspaceRole === 'admin'

  const currentUserEmail = useMemo(() => {
    const email = currentUser?.email
    if (typeof email !== 'string') {
      return null
    }
    const trimmed = email.trim()
    return trimmed.length > 0 ? trimmed.toLowerCase() : null
  }, [currentUser?.email])

  const currentUserDisplayName = useMemo(() => {
    const first =
      typeof currentUser?.first_name === 'string'
        ? currentUser.first_name.trim()
        : ''
    const last =
      typeof currentUser?.last_name === 'string'
        ? currentUser.last_name.trim()
        : ''
    const fullName = [first, last].filter((part) => part.length > 0).join(' ')
    if (fullName.length > 0) {
      return fullName.toLowerCase()
    }
    return null
  }, [currentUser?.first_name, currentUser?.last_name])

  const matchesCurrentUser = useCallback(
    (entry: WorkspaceConnectionInfo) => {
      const sharedEmail =
        typeof entry.sharedByEmail === 'string'
          ? entry.sharedByEmail.trim().toLowerCase()
          : null
      if (sharedEmail && currentUserEmail) {
        return sharedEmail === currentUserEmail
      }
      const sharedName =
        typeof entry.sharedByName === 'string'
          ? entry.sharedByName.trim().toLowerCase()
          : null
      if (sharedName && currentUserDisplayName) {
        return sharedName === currentUserDisplayName
      }
      return false
    },
    [currentUserDisplayName, currentUserEmail]
  )

  const openPlanSettings = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      // Ensure a clean slate between mounts or workspace switches
      // so prior in-memory state from other renders/tests cannot
      // leak into this view.
      setConnections(null)
      try {
        const data = await fetchConnections({ workspaceId })
        if (!active) return
        setConnections({
          personal: data.personal.map((p) => ({ ...p })),
          workspace: data.workspace.map((w) => ({ ...w }))
        })
        setError(null)
      } catch (err) {
        if (!active) return
        setError(
          err instanceof Error ? err.message : 'Failed to load connections'
        )
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [workspaceId])

  const noticeText = useMemo(() => {
    if (!notice) return null
    if (notice.kind === 'connected') {
      const providerName =
        PROVIDERS.find((p) => p.key === notice.provider)?.name ?? 'Integration'
      return `${providerName} is now connected.`
    }
    const providerName = notice.provider
      ? (PROVIDERS.find((p) => p.key === notice.provider)?.name ??
        'Integration')
      : 'Integration'
    return notice.message
      ? `${providerName}: ${notice.message}`
      : `${providerName} failed to connect.`
  }, [notice])

  const handleConnect = (provider: OAuthProvider) => {
    if (isSoloPlan || isViewer) {
      return
    }
    const url = new URL(`${API_BASE_URL}/api/oauth/${provider}/start`)
    if (workspaceId) {
      url.searchParams.set('workspace', workspaceId)
    }
    window.location.href = url.toString()
  }

  const performDisconnect = useCallback(
    async (
      provider: OAuthProvider,
      sharedConnections: WorkspaceConnectionInfo[]
    ): Promise<boolean> => {
      setBusyProvider(provider)
      try {
        for (const entry of sharedConnections) {
          if (removeBusyId === entry.id) {
            continue
          }
          if (!entry.id) {
            continue
          }
          await unshareWorkspaceConnection(entry.workspaceId, entry.id)
        }
        await disconnectProvider(provider)
        setConnections((prev) => {
          const next: GroupedConnectionsSnapshot = {
            personal: Array.isArray(prev?.personal)
              ? prev!.personal.map((p) =>
                  p.provider === provider
                    ? {
                        ...p,
                        id: null,
                        connected: false,
                        requiresReconnect: false,
                        isShared: false,
                        accountEmail: undefined,
                        expiresAt: undefined,
                        lastRefreshedAt: undefined
                      }
                    : { ...p }
                )
              : [],
            workspace: Array.isArray(prev?.workspace)
              ? prev!.workspace
                  .filter(
                    (entry) =>
                      entry.provider !== provider ||
                      !sharedConnections.some(
                        (shared) => shared.id === entry.id
                      )
                  )
                  .map((entry) => ({ ...entry }))
              : []
          }
          setCachedConnections(next, { workspaceId })
          return next
        })
        setError(null)
        return true
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to disconnect provider'
        setError(message)
        return false
      } finally {
        setBusyProvider(null)
      }
    },
    [removeBusyId, workspaceId]
  )

  const handleDisconnect = useCallback(
    (provider: OAuthProvider) => {
      const status = (() => {
        const personalRecord = connections?.personal.find(
          (p) => p.provider === provider
        )
        const workspace = (connections?.workspace ?? []).filter(
          (w) => w.provider === provider
        )
        return {
          personal: personalRecord
            ? {
                scope: 'personal' as const,
                id: personalRecord.id ?? null,
                connected: Boolean(
                  personalRecord.connected && personalRecord.id
                ),
                accountEmail: personalRecord.accountEmail,
                expiresAt: personalRecord.expiresAt,
                lastRefreshedAt: personalRecord.lastRefreshedAt,
                requiresReconnect: Boolean(personalRecord.requiresReconnect),
                isShared: Boolean(personalRecord.isShared)
              }
            : emptyProviderState().personal,
          workspace
        } as ProviderConnectionSet
      })()
      // backend enforces workspace boundary; use workspace entries as-is
      const workspaceConnections = status?.workspace ?? []
      const sharedConnections = workspaceConnections.filter((entry) =>
        matchesCurrentUser(entry)
      )

      if (sharedConnections.length > 0) {
        setDisconnectDialog({ provider, sharedConnections })
        return
      }

      void performDisconnect(provider, [])
    },
    [connections, matchesCurrentUser, performDisconnect]
  )

  const handleRefresh = async (provider: OAuthProvider) => {
    setBusyProvider(provider)
    try {
      const updated = await refreshProvider(provider)
      setConnections((prev) => {
        const next: GroupedConnectionsSnapshot = {
          personal: Array.isArray(prev?.personal)
            ? prev!.personal.map((p) => {
                if (p.provider !== provider) return { ...p }
                const patch: any = {
                  ...p,
                  connected: true,
                  requiresReconnect: false
                }
                if (typeof updated.accountEmail !== 'undefined') {
                  patch.accountEmail = updated.accountEmail
                }
                if (typeof updated.expiresAt !== 'undefined') {
                  patch.expiresAt = updated.expiresAt
                }
                if (typeof updated.lastRefreshedAt !== 'undefined') {
                  patch.lastRefreshedAt = updated.lastRefreshedAt
                }
                return patch
              })
            : [],
          workspace: Array.isArray(prev?.workspace)
            ? prev!.workspace.map((w) => ({ ...w }))
            : []
        }
        setCachedConnections(next, { workspaceId })
        return next
      })
    } catch (err) {
      if (err && typeof err === 'object' && (err as any).requiresReconnect) {
        markProviderRevoked(provider)
        setConnections((prev) => {
          const next: GroupedConnectionsSnapshot = {
            personal: Array.isArray(prev?.personal)
              ? prev!.personal.map((p) =>
                  p.provider === provider
                    ? { ...p, connected: false, requiresReconnect: true }
                    : { ...p }
                )
              : [
                  {
                    provider,
                    scope: 'personal',
                    id: null,
                    connected: false,
                    accountEmail: undefined,
                    expiresAt: undefined,
                    lastRefreshedAt: undefined,
                    requiresReconnect: true,
                    isShared: false
                  }
                ],
            workspace: Array.isArray(prev?.workspace)
              ? prev!.workspace.filter((w) => w.provider !== provider)
              : []
          }
          return next
        })
        setError(
          err instanceof Error
            ? err.message
            : 'Connection requires reconnection'
        )
        return
      }
      const message =
        err instanceof Error ? err.message : 'Failed to refresh tokens'
      setError(message)
    } finally {
      setBusyProvider(null)
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Integrations
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Connect OAuth accounts that workflows can use for delegated access.
          DSentr manages the client credentials and refreshes access tokens
          automatically.
        </p>
      </header>

      {isSoloPlan ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex items-start justify-between gap-2">
            <span>
              OAuth integrations are available on workspace plans and above.
              Upgrade in Settings → Plan to connect accounts for workflows.
            </span>
            <button
              type="button"
              onClick={openPlanSettings}
              className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-50 dark:hover:bg-amber-400/10"
            >
              Upgrade
            </button>
          </div>
        </div>
      ) : null}

      {!isSoloPlan && isViewer ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 shadow-sm dark:border-blue-400/50 dark:bg-blue-500/10 dark:text-blue-100">
          Workspace viewers cannot connect OAuth integrations. Ask a workspace
          admin to share their credentials or upgrade your permissions.
        </div>
      ) : null}

      {noticeText && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-900/20 dark:text-emerald-100">
          <div className="flex items-start justify-between gap-3">
            <span>{noticeText}</span>
            {onDismissNotice && (
              <button
                className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200"
                onClick={onDismissNotice}
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-500/60 dark:bg-red-900/20 dark:text-red-100">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-300">
          Loading integrations…
        </div>
      ) : (
        <div className="space-y-4">
          {PROVIDERS.map((provider) => {
            const status: ProviderConnectionSet = (() => {
              const personalRecord = connections?.personal.find(
                (p) => p.provider === provider.key
              )
              const workspace = (connections?.workspace ?? []).filter(
                (w) => w.provider === provider.key
              )
              return {
                personal: personalRecord
                  ? {
                      scope: 'personal' as const,
                      id: personalRecord.id ?? null,
                      connected: Boolean(
                        personalRecord.connected && personalRecord.id
                      ),
                      accountEmail: personalRecord.accountEmail,
                      expiresAt: personalRecord.expiresAt,
                      lastRefreshedAt: personalRecord.lastRefreshedAt,
                      requiresReconnect: Boolean(
                        personalRecord.requiresReconnect
                      ),
                      isShared: Boolean(personalRecord.isShared)
                    }
                  : emptyProviderState().personal,
                workspace
              }
            })()
            const personal = status?.personal
            const connected = personal?.connected ?? false
            const accountEmail = personal?.accountEmail
            const expiresAt = personal?.expiresAt
            const lastRefreshedAt = personal?.lastRefreshedAt
            const personalRequiresReconnect =
              personal?.requiresReconnect ?? false
            const busy = busyProvider === provider.key
            const promoting = promoteBusyProvider === provider.key
            const workspaceConnections = (status?.workspace ?? []).filter(
              (entry) => !workspaceId || entry.workspaceId === workspaceId
            )
            const workspaceRequiresReconnect = workspaceConnections.some(
              (entry) => entry.requiresReconnect
            )
            const promoteDisabled =
              !workspaceId ||
              promoting ||
              busy ||
              !connected ||
              personal?.isShared

            return (
              <section
                key={provider.key}
                className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {provider.name}
                    </h3>
                    <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                      {provider.description}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {connected ? (
                      <>
                        <button
                          onClick={() => handleRefresh(provider.key)}
                          disabled={busy || promoting}
                          className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Refresh token
                        </button>
                        <button
                          onClick={() => handleDisconnect(provider.key)}
                          disabled={busy || promoting}
                          className="rounded-md bg-red-500 px-3 py-1 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                        {canPromote && !personal?.isShared ? (
                          <button
                            onClick={() =>
                              setPromoteDialogProvider(provider.key)
                            }
                            disabled={promoteDisabled}
                            className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                          >
                            Promote to Workspace
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <button
                        aria-label={`Connect ${provider.name}`}
                        onClick={() => handleConnect(provider.key)}
                        disabled={isSoloPlan || isViewer}
                        className="rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>

                <dl className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <div className="flex items-center gap-2">
                    <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                      Status:
                    </dt>
                    <dd>
                      {personalRequiresReconnect
                        ? 'Reconnect required'
                        : connected
                          ? 'Connected'
                          : 'Not connected'}
                    </dd>
                  </div>
                  {personalRequiresReconnect ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      This connection was revoked by the provider. Reconnect to
                      restore access.
                    </p>
                  ) : null}
                  {personal?.isShared ? (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-300">
                      <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                        Sharing:
                      </dt>
                      <dd>Promoted to workspace</dd>
                    </div>
                  ) : null}
                  {accountEmail && (
                    <div className="flex items-center gap-2">
                      <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                        Account:
                      </dt>
                      <dd>{accountEmail}</dd>
                    </div>
                  )}
                  {expiresAt && (
                    <div className="flex items-center gap-2">
                      <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                        Token expires:
                      </dt>
                      <dd>{new Date(expiresAt).toLocaleString()}</dd>
                    </div>
                  )}
                  {lastRefreshedAt && (
                    <div className="flex items-center gap-2">
                      <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                        Last refreshed:
                      </dt>
                      <dd>{new Date(lastRefreshedAt).toLocaleString()}</dd>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                      Scopes:
                    </dt>
                    <dd className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {provider.scopes}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200">
                    Workspace connections
                  </div>
                  {workspaceRequiresReconnect ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      One or more shared credentials were revoked. Workspace
                      admins must reconnect them to continue using workflows.
                    </p>
                  ) : null}
                  {workspaceConnections.length === 0 ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      No workspace connections have been shared yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {workspaceConnections.map((entry) => (
                        <li
                          key={entry.id}
                          className={`rounded border px-3 py-2 text-xs ${
                            entry.requiresReconnect
                              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/70 dark:bg-red-500/10 dark:text-red-200'
                              : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}
                        >
                          <div className="font-medium text-zinc-700 dark:text-zinc-100">
                            {entry.workspaceName}
                          </div>
                          <div className="text-zinc-600 dark:text-zinc-300">
                            {entry.accountEmail || 'Delegated account'}
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            Shared by {entry.sharedByName || 'workspace admin'}
                            {entry.sharedByEmail
                              ? ` (${entry.sharedByEmail})`
                              : ''}
                          </div>
                          {entry.lastRefreshedAt ? (
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              Last refreshed{' '}
                              {new Date(entry.lastRefreshedAt).toLocaleString()}
                            </div>
                          ) : null}
                          {entry.requiresReconnect ? (
                            <div className="text-[11px] font-semibold text-red-600 dark:text-red-300">
                              Reconnect required by the credential owner.
                            </div>
                          ) : null}
                          {canPromote ? (
                            <div className="mt-2 flex justify-end">
                              <button
                                onClick={() => setRemoveDialog(entry)}
                                disabled={
                                  removeBusyId === entry.id || busy || promoting
                                }
                                className="rounded-md bg-red-500 px-2 py-1 text-xs font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
                              >
                                Remove from workspace
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        isOpen={promoteDialogProvider !== null}
        title="Promote OAuth Connection"
        message="Share this connection with your workspace so other members can run workflows using it?"
        confirmText="Promote"
        onCancel={() => setPromoteDialogProvider(null)}
        onConfirm={async () => {
          const provider = promoteDialogProvider
          if (!provider) return
          const personalRecord = connections?.personal.find(
            (p) => p.provider === provider
          )
          if (!workspaceId) {
            setError('No active workspace selected for promotion')
            setPromoteDialogProvider(null)
            return
          }
          if (!personalRecord?.id) {
            setError('Missing connection identifier. Refresh and try again.')
            setPromoteDialogProvider(null)
            return
          }
          try {
            setPromoteBusyProvider(provider)
            const promotion = await promoteConnection({
              workspaceId,
              provider,
              connectionId: personalRecord.id
            })
            const workspaceConnectionId = promotion.workspaceConnectionId
            if (!workspaceConnectionId) {
              throw new Error('Missing workspace connection identifier')
            }
            const workspaceName =
              currentWorkspace?.workspace.name?.trim() ?? 'Workspace connection'
            const sharedByName =
              currentUser?.first_name || currentUser?.last_name
                ? [currentUser?.first_name, currentUser?.last_name]
                    .filter((part) => part && part.trim().length > 0)
                    .join(' ')
                : undefined
            const sharedByEmail = currentUser?.email?.trim() || undefined

            setConnections((prev) => {
              const next: GroupedConnectionsSnapshot = {
                personal: Array.isArray(prev?.personal)
                  ? prev!.personal.map((p) =>
                      p.provider === provider
                        ? { ...p, requiresReconnect: false, isShared: true }
                        : { ...p }
                    )
                  : [],
                workspace: Array.isArray(prev?.workspace)
                  ? prev!.workspace
                      .filter(
                        (entry) =>
                          entry.provider !== provider ||
                          (entry.id !== workspaceConnectionId &&
                            entry.id !== personalRecord.id)
                      )
                      .map((entry) => ({ ...entry }))
                  : []
              }

              const workspaceEntry: WorkspaceConnectionInfo = {
                scope: 'workspace',
                id: workspaceConnectionId,
                connected: true,
                provider,
                accountEmail: personalRecord.accountEmail,
                expiresAt: personalRecord.expiresAt,
                lastRefreshedAt: personalRecord.lastRefreshedAt,
                workspaceId,
                workspaceName,
                sharedByName,
                sharedByEmail,
                requiresReconnect: false
              }

              next.workspace = [...next.workspace, workspaceEntry]
              setCachedConnections(next, { workspaceId })
              return next
            })
            setError(null)
            // After promotion, attempt a best-effort refresh to pick up any
            // server-side metadata updates. This also consumes any pending
            // mocked responses in tests that expect a follow-up fetch.
            try {
              const data = await fetchConnections({ workspaceId })
              setConnections({
                personal: data.personal.map((p) => ({ ...p })),
                workspace: data.workspace.map((w) => ({ ...w }))
              })
            } catch {
              // ignore refresh failures
            }
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : 'Failed to promote connection'
            )
          } finally {
            setPromoteBusyProvider(null)
            setPromoteDialogProvider(null)
          }
        }}
      />
      <ConfirmDialog
        isOpen={removeDialog !== null}
        title="Remove Workspace Connection"
        message={(() => {
          if (!removeDialog) {
            return 'Stop sharing this connection with the workspace?'
          }
          const providerName =
            PROVIDERS.find((p) => p.key === removeDialog.provider)?.name ??
            'Integration'
          const workspaceName = removeDialog.workspaceName?.trim().length
            ? removeDialog.workspaceName
            : 'this workspace'
          return `Stop sharing the ${providerName} connection with ${workspaceName}? Workflows that rely on this connection may stop working.`
        })()}
        confirmText="Remove"
        onCancel={() => {
          setRemoveDialog(null)
          setRemoveBusyId(null)
        }}
        onConfirm={async () => {
          const entry = removeDialog
          if (!entry) return
          if (!entry.id) {
            setError(
              'Missing workspace connection identifier. Refresh and try again.'
            )
            setRemoveDialog(null)
            return
          }
          try {
            setRemoveBusyId(entry.id)
            await unshareWorkspaceConnection(entry.workspaceId, entry.id)
            setConnections((prev) => {
              const nextWorkspace = (prev?.workspace ?? [])
                .filter((workspaceEntry) => workspaceEntry.id !== entry.id)
                .map((workspaceEntry) => ({ ...workspaceEntry }))

              const shouldClearSharedFlag =
                matchesCurrentUser(entry) &&
                !nextWorkspace.some(
                  (workspaceEntry) =>
                    workspaceEntry.provider === entry.provider &&
                    matchesCurrentUser(workspaceEntry)
                )

              const nextPersonal = (prev?.personal ?? []).map((p) =>
                p.provider === entry.provider && shouldClearSharedFlag
                  ? { ...p, isShared: false }
                  : { ...p }
              )

              const next: GroupedConnectionsSnapshot = {
                personal: nextPersonal,
                workspace: nextWorkspace
              }
              setCachedConnections(next, { workspaceId })
              return next
            })
            setError(null)
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : 'Failed to remove workspace connection'
            )
          } finally {
            setRemoveBusyId(null)
            setRemoveDialog(null)
          }
        }}
      />
      <ConfirmDialog
        isOpen={disconnectDialog !== null}
        title="Remove Shared Credential"
        message={(() => {
          if (!disconnectDialog) {
            return 'Disconnect this OAuth credential?'
          }
          const providerName =
            PROVIDERS.find((p) => p.key === disconnectDialog.provider)?.name ??
            'this provider'
          const workspaces = disconnectDialog.sharedConnections
            .map((entry) =>
              entry.workspaceName?.trim().length
                ? entry.workspaceName
                : 'this workspace'
            )
            .filter((name, index, arr) => arr.indexOf(name) === index)
          const workspaceText =
            workspaces.length === 0
              ? 'your workspace'
              : workspaces.length === 1
                ? workspaces[0]
                : `${workspaces.slice(0, -1).join(', ')} and ${
                    workspaces[workspaces.length - 1]
                  }`
          return `Disconnecting this ${providerName} credential will also remove the shared connection from ${workspaceText}. Existing workflows may stop working if they rely on it. Do you want to continue?`
        })()}
        confirmText="Remove credential"
        onCancel={() => {
          setDisconnectDialog(null)
        }}
        onConfirm={async () => {
          if (!disconnectDialog) {
            return
          }
          if (busyProvider === disconnectDialog.provider) {
            return
          }
          const ok = await performDisconnect(
            disconnectDialog.provider,
            disconnectDialog.sharedConnections
          )
          if (ok) {
            setDisconnectDialog(null)
          }
        }}
      />
    </div>
  )
}

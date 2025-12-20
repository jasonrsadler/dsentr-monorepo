import { JSX, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import SlackIcon from '@/assets/svg-components/third-party/SlackIcon'
import { API_BASE_URL } from '@/lib/config'
import { errorMessage } from '@/lib/errorMessage'
import AsanaIcon from '@/assets/svg-components/third-party/AsanaIcon'
import {
  OAuthProvider,
  WorkspaceConnectionInfo,
  disconnectProvider,
  fetchConnections,
  refreshProvider,
  promoteConnection,
  unshareWorkspaceConnection,
  setCachedConnections,
  type GroupedConnectionsSnapshot,
  type PersonalConnectionRecord
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { normalizePlanTier, type PlanTier } from '@/lib/planTiers'
import ConfirmDialog from '@/components/ui/dialog/ConfirmDialog'
import GoogleIcon from '@/assets/svg-components/third-party/GoogleIcon'
import MicrosoftIcon from '@/assets/svg-components/third-party/MicrosoftIcon'
import { useWorkflowStore } from '@/stores/workflowStore'

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

const PROVIDER_ICONS: Partial<
  Record<OAuthProvider, (props: React.SVGProps<SVGSVGElement>) => JSX.Element>
> = {
  slack: SlackIcon,
  google: GoogleIcon,
  microsoft: MicrosoftIcon,
  asana: AsanaIcon
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
  },
  {
    key: 'asana',
    name: 'Asana',
    description:
      'Connect Asana to create and update projects, tasks, and comments directly from your workflows.',
    scopes: 'default email'
  }
]

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
  const [providerQuery, setProviderQuery] = useState('')
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null)
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null)
  const [connectingProvider, setConnectingProvider] =
    useState<OAuthProvider | null>(null)
  const [promoteDialogConnection, setPromoteDialogConnection] =
    useState<PersonalConnectionRecord | null>(null)
  const [promoteBusyProvider, setPromoteBusyProvider] =
    useState<OAuthProvider | null>(null)
  const [removeDialog, setRemoveDialog] =
    useState<WorkspaceConnectionInfo | null>(null)
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null)
  const [disconnectDialog, setDisconnectDialog] = useState<{
    connection: PersonalConnectionRecord
    sharedConnections: WorkspaceConnectionInfo[]
  } | null>(null)
  const [expandedProviders, setExpandedProviders] = useState<
    Record<OAuthProvider, boolean>
  >(() =>
    PROVIDERS.reduce(
      (acc, provider) => {
        acc[provider.key] = false
        return acc
      },
      {} as Record<OAuthProvider, boolean>
    )
  )

  const sortedProviders = useMemo(() => {
    const term = providerQuery.trim().toLowerCase()
    const ordered = [...PROVIDERS].sort((a, b) => a.name.localeCompare(b.name))
    if (!term) {
      return ordered
    }
    return ordered.filter(
      (provider) =>
        provider.name.toLowerCase().includes(term) ||
        provider.description.toLowerCase().includes(term)
    )
  }, [providerQuery])

  const planTier = useMemo<PlanTier>((): PlanTier => {
    return normalizePlanTier(
      currentWorkspace?.workspace.plan ?? userPlan ?? undefined
    )
  }, [currentWorkspace?.workspace.plan, userPlan])
  const workflowIsDirty = useWorkflowStore((state) => state.isDirty)
  const isSoloPlan = planTier === 'solo'
  const isViewer = workspaceRole === 'viewer'
  const canPromote = workspaceRole === 'owner' || workspaceRole === 'admin'

  const resolveConnectionKey = useCallback(
    (entry?: { connectionId?: string | null; id?: string | null } | null) => {
      if (!entry) return null
      const raw =
        typeof entry.connectionId === 'string'
          ? entry.connectionId
          : typeof entry.id === 'string'
            ? entry.id
            : null
      if (!raw) return null
      const trimmed = raw.trim()
      return trimmed.length > 0 ? trimmed : null
    },
    []
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
      if (isSoloPlan) {
        setConnections({ personal: [], workspace: [] })
        setError(null)
        setLoading(false)
        return
      }

      setLoading(true)
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
  }, [workspaceId, isSoloPlan])

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

  const requestWorkflowSave = useCallback(async () => {
    if (!workflowIsDirty) return true
    if (typeof window === 'undefined') return true
    return await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      try {
        window.dispatchEvent(
          new CustomEvent('dsentr-request-workflow-save', {
            detail: { resolve: finish, reason: 'oauth-connect' }
          })
        )
      } catch {
        finish(false)
        return
      }
      setTimeout(() => finish(false), 8000)
    })
  }, [workflowIsDirty])

  const handleConnect = useCallback(
    async (provider: OAuthProvider) => {
      if (isSoloPlan || isViewer || connectingProvider) {
        return
      }
      setConnectingProvider(provider)
      try {
        const saved = await requestWorkflowSave()
        if (!saved) {
          setError(
            'Failed to save your workflow before connecting. Please save and try again.'
          )
          return
        }
        const url = new URL(`${API_BASE_URL}/api/oauth/${provider}/start`)
        if (workspaceId) {
          url.searchParams.set('workspace', workspaceId)
        }
        window.location.href = url.toString()
      } finally {
        setConnectingProvider(null)
      }
    },
    [
      isSoloPlan,
      isViewer,
      connectingProvider,
      requestWorkflowSave,
      workspaceId,
      setError
    ]
  )

  const toggleProvider = useCallback((providerKey: OAuthProvider) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [providerKey]: !(prev?.[providerKey] ?? true)
    }))
  }, [])

  const performDisconnect = useCallback(
    async (
      connection: PersonalConnectionRecord,
      sharedConnections: WorkspaceConnectionInfo[]
    ): Promise<boolean> => {
      const provider = connection.provider
      const connectionKey = resolveConnectionKey(connection)
      if (!connectionKey) {
        setError('Select a connection with an ID before disconnecting.')
        return false
      }
      setBusyProvider(provider)
      setBusyConnectionId(connectionKey)
      try {
        for (const entry of sharedConnections) {
          if (removeBusyId === entry.id || !entry.id) {
            continue
          }
          await unshareWorkspaceConnection(entry.workspaceId, entry.id)
        }
        await disconnectProvider(provider, connectionKey)
        setConnections((prev) => {
          const nextPersonal = (prev?.personal ?? [])
            .filter((p) => {
              if (p.provider !== provider) return true
              const personalKey = resolveConnectionKey(p)
              return personalKey !== connectionKey
            })
            .map((p) => ({ ...p }))
          const sharedIds = new Set(
            sharedConnections
              .map((entry) => entry.id)
              .filter((value): value is string => Boolean(value))
          )
          const nextWorkspace = (prev?.workspace ?? [])
            .filter((entry) => (entry.id ? !sharedIds.has(entry.id) : true))
            .map((entry) => ({ ...entry }))

          const next: GroupedConnectionsSnapshot = {
            personal: nextPersonal,
            workspace: nextWorkspace
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
        setBusyConnectionId(null)
      }
    },
    [removeBusyId, resolveConnectionKey, workspaceId]
  )

  const handleDisconnect = useCallback(
    (connection: PersonalConnectionRecord) => {
      const connectionKey = resolveConnectionKey(connection)
      if (!connectionKey) {
        setError('Select a connection with an ID before disconnecting.')
        return
      }
      const workspaceConnections = (connections?.workspace ?? []).filter(
        (entry) => {
          if (entry.provider !== connection.provider) return false
          const entryKey = resolveConnectionKey(entry)
          return entryKey === connectionKey
        }
      )

      const sharedConnections = workspaceConnections
      if (sharedConnections.length > 0) {
        setDisconnectDialog({ connection, sharedConnections })
        return
      }

      void performDisconnect(connection, [])
    },
    [connections, performDisconnect, resolveConnectionKey]
  )

  const handleRefresh = useCallback(
    async (
      provider: OAuthProvider,
      target?: PersonalConnectionRecord | WorkspaceConnectionInfo
    ) => {
      const connectionKey = resolveConnectionKey(target)
      if (!connectionKey) {
        setError('Select a connection with an ID before refreshing.')
        return
      }
      setBusyProvider(provider)
      setBusyConnectionId(connectionKey)
      try {
        const updated = await refreshProvider(provider, connectionKey)
        setConnections((prev) => {
          const mapConnection = <
            T extends { provider: OAuthProvider } & {
              connectionId?: string | null
              id?: string | null
            }
          >(
            entries: T[]
          ): T[] =>
            entries.map((entry) => {
              if (entry.provider !== provider) return { ...entry }
              const entryKey = resolveConnectionKey(entry)
              if (connectionKey && entryKey !== connectionKey) {
                return { ...entry }
              }
              const patch: any = {
                ...entry,
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

          const nextPersonal = mapConnection(prev?.personal ?? [])
          const nextWorkspace = mapConnection(prev?.workspace ?? [])
          const next: GroupedConnectionsSnapshot = {
            personal: nextPersonal,
            workspace: nextWorkspace
          }
          setCachedConnections(next, { workspaceId })
          return next
        })
      } catch (err) {
        const requiresReconnect =
          err && typeof err === 'object' && (err as any).requiresReconnect
        if (requiresReconnect) {
          setConnections((prev) => {
            const nextPersonal = (prev?.personal ?? []).map((p) => {
              if (p.provider !== provider) return { ...p }
              const entryKey = resolveConnectionKey(p)
              if (connectionKey && entryKey !== connectionKey) {
                return { ...p }
              }
              return {
                ...p,
                connected: false,
                requiresReconnect: true,
                id: p.id ?? null
              }
            })
            const nextWorkspace = (prev?.workspace ?? []).filter((w) => {
              if (w.provider !== provider) return true
              const entryKey = resolveConnectionKey(w)
              return entryKey !== null && entryKey !== connectionKey
            })
            const next: GroupedConnectionsSnapshot = {
              personal: nextPersonal,
              workspace: nextWorkspace
            }
            setCachedConnections(next, { workspaceId })
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
        setBusyConnectionId(null)
      }
    },
    [resolveConnectionKey, workspaceId]
  )

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
              Upgrade in Settings â†’ Plan to connect accounts for workflows.
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
          Loading integrations...
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label
              htmlFor="integration-search"
              className="text-sm font-semibold text-zinc-700 dark:text-zinc-200"
            >
              Search providers
            </label>
            <input
              id="integration-search"
              type="search"
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.target.value)}
              placeholder="Filter by name"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          {sortedProviders.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              No providers match your search.
            </div>
          ) : (
            sortedProviders.map((provider) => {
              const personalConnections = (connections?.personal ?? []).filter(
                (entry) => entry.provider === provider.key
              )
              const workspaceConnections = (
                connections?.workspace ?? []
              ).filter((entry) => entry.provider === provider.key)
              const connected = personalConnections.some(
                (entry) => entry.connected && resolveConnectionKey(entry)
              )
              const personalRequiresReconnect = personalConnections.some(
                (entry) => entry.requiresReconnect
              )
              const workspaceRequiresReconnect = workspaceConnections.some(
                (entry) => entry.requiresReconnect
              )
              const connecting = connectingProvider === provider.key
              const busy = busyProvider === provider.key
              const promoting = promoteBusyProvider === provider.key
              const isExpanded = expandedProviders[provider.key] ?? true
              const connectLabel =
                personalConnections.length > 0 ? 'Add connection' : 'Connect'
              const personalCount = personalConnections.length
              const workspaceCount = workspaceConnections.length
              const personalSorted = [...personalConnections].sort((a, b) => {
                const aEmail = a.accountEmail ?? ''
                const bEmail = b.accountEmail ?? ''
                if (aEmail && bEmail && aEmail !== bEmail) {
                  return aEmail.localeCompare(bEmail)
                }
                const aKey = resolveConnectionKey(a) ?? ''
                const bKey = resolveConnectionKey(b) ?? ''
                return aKey.localeCompare(bKey)
              })
              const workspaceSorted = [...workspaceConnections].sort((a, b) =>
                (a.workspaceName ?? '').localeCompare(b.workspaceName ?? '')
              )
              const workspaceConnectionIds = new Set(
                workspaceConnections
                  .map((workspaceEntry) => {
                    if (typeof workspaceEntry.connectionId !== 'string') {
                      return null
                    }
                    const trimmed = workspaceEntry.connectionId.trim()
                    return trimmed.length > 0 ? trimmed : null
                  })
                  .filter((value): value is string => Boolean(value))
              )

              return (
                <section
                  key={provider.key}
                  className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <button
                    type="button"
                    onClick={() => toggleProvider(provider.key)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-zinc-800/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-xs font-semibold uppercase text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500">
                        {(() => {
                          const Logo = PROVIDER_ICONS[provider.key]
                          if (Logo) {
                            return (
                              <Logo
                                aria-hidden="true"
                                className="h-7 w-7"
                                focusable="false"
                              />
                            )
                          }
                          return (
                            <span aria-hidden="true">
                              {provider.name.slice(0, 1)}
                            </span>
                          )
                        })()}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                          {provider.name}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {personalCount} personal · {workspaceCount} workspace
                        </span>
                      </div>
                    </div>
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-5 w-5 text-zinc-500 transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <div
                    aria-hidden={!isExpanded}
                    className={`overflow-hidden transition-[max-height,opacity,transform] duration-200 ease-out ${
                      isExpanded
                        ? 'max-h-[2200px] border-t border-zinc-200 px-4 pb-4 pt-2 opacity-100 dark:border-zinc-800'
                        : 'max-h-0 border-t border-transparent px-4 pb-0 pt-0 opacity-0 dark:border-transparent'
                    } ${!isExpanded ? '-translate-y-1 pointer-events-none' : 'translate-y-0'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                          {provider.name}
                        </h3>
                        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                          {provider.description}
                        </p>
                      </div>
                      <button
                        aria-label={`Connect ${provider.name}`}
                        onClick={() => handleConnect(provider.key)}
                        disabled={isSoloPlan || isViewer || connecting}
                        className="rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {connecting ? 'Saving...' : connectLabel}
                      </button>
                    </div>

                    <dl className="mt-4 grid grid-cols-1 gap-2 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-2">
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
                      <div className="flex items-center gap-2">
                        <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                          Personal connections:
                        </dt>
                        <dd>{personalCount || 'None'}</dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                          Workspace connections:
                        </dt>
                        <dd>{workspaceCount || 'None'}</dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                          Scopes:
                        </dt>
                        <dd className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          {provider.scopes}
                        </dd>
                      </div>
                    </dl>
                    {personalRequiresReconnect ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        One or more personal connections were revoked. Reconnect
                        to restore access.
                      </p>
                    ) : null}

                    <div className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-zinc-700 dark:text-zinc-200">
                          Your connections
                        </div>
                        <button
                          aria-label={`Add ${provider.name} connection`}
                          onClick={() => handleConnect(provider.key)}
                          disabled={
                            isSoloPlan ||
                            isViewer ||
                            connectingProvider === provider.key
                          }
                          className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Add connection
                        </button>
                      </div>
                      {personalSorted.length === 0 ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          No personal connections have been created yet.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {personalSorted.map((entry, index) => {
                            const entryKey = resolveConnectionKey(entry)
                            const hasValidId = Boolean(entryKey)
                            const connectionId =
                              typeof entry.connectionId === 'string'
                                ? entry.connectionId.trim()
                                : ''
                            const hasValidConnectionId = connectionId.length > 0
                            const isShared = hasValidConnectionId
                              ? workspaceConnectionIds.has(connectionId)
                              : false
                            const actionDisabled =
                              busy ||
                              busyConnectionId === entryKey ||
                              promoting ||
                              !hasValidId
                            const requiresReconnect = entry.requiresReconnect
                            const canShowPromote =
                              canPromote && !isShared && hasValidConnectionId
                            return (
                              <li
                                key={
                                  entryKey ??
                                  entry.id ??
                                  `${provider.key}-personal-${index}`
                                }
                                className={`rounded border px-3 py-2 text-xs ${
                                  requiresReconnect
                                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/70 dark:bg-red-500/10 dark:text-red-200'
                                    : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <div className="font-medium text-zinc-700 dark:text-zinc-100">
                                      {entry.accountEmail ||
                                        'Delegated account'}
                                    </div>
                                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                      Connection ID: {entryKey ?? 'Unavailable'}
                                    </div>
                                    {!hasValidId ? (
                                      <div className="text-[11px] text-amber-600 dark:text-amber-400">
                                        Refresh the connection list to manage
                                        this credential.
                                      </div>
                                    ) : null}
                                    {isShared ? (
                                      <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
                                        Shared with workspace
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      onClick={() =>
                                        handleRefresh(provider.key, entry)
                                      }
                                      disabled={actionDisabled}
                                      className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                    >
                                      Refresh
                                    </button>
                                    <button
                                      onClick={() => handleDisconnect(entry)}
                                      disabled={actionDisabled}
                                      className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Disconnect
                                    </button>
                                    {canShowPromote ? (
                                      <>
                                        <button
                                          onClick={() => {
                                            if (!hasValidId) return
                                            setPromoteDialogConnection(entry)
                                          }}
                                          disabled={
                                            actionDisabled ||
                                            !workspaceId ||
                                            requiresReconnect ||
                                            !hasValidConnectionId
                                          }
                                          className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          Promote to workspace
                                        </button>
                                      </>
                                    ) : null}
                                    {canPromote &&
                                    !isShared &&
                                    !hasValidConnectionId ? (
                                      <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                                        Select a personal connection to promote.
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                  {requiresReconnect ? (
                                    <div className="font-semibold text-red-600 dark:text-red-300">
                                      Reconnect required by the provider.
                                    </div>
                                  ) : null}
                                  {entry.lastRefreshedAt ? (
                                    <div>
                                      Last refreshed{' '}
                                      {new Date(
                                        entry.lastRefreshedAt
                                      ).toLocaleString()}
                                    </div>
                                  ) : null}
                                  {entry.expiresAt ? (
                                    <div>
                                      Token expires{' '}
                                      {new Date(
                                        entry.expiresAt
                                      ).toLocaleString()}
                                    </div>
                                  ) : null}
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>

                    {provider.key === 'slack' &&
                    workspaceConnections.length > 0 ? (
                      <div className="mt-3 rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        <div className="font-semibold text-zinc-800 dark:text-zinc-100">
                          Slack connected to workspace
                        </div>
                        <div className="mt-0.5">
                          Posting method:{' '}
                          {workspaceConnections.some(
                            (entry) => entry.hasIncomingWebhook
                          )
                            ? 'Incoming Webhook'
                            : 'OAuth'}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                      <div className="font-semibold text-zinc-700 dark:text-zinc-200">
                        Workspace connections
                      </div>
                      {workspaceRequiresReconnect ? (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          One or more shared credentials were revoked. Workspace
                          admins must reconnect them to continue using
                          workflows.
                        </p>
                      ) : null}
                      {workspaceSorted.length === 0 ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          No workspace connections have been shared yet.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {workspaceSorted.map((entry, index) => {
                            const entryKey = resolveConnectionKey(entry)
                            const workspaceKey =
                              entry.workspaceConnectionId ?? entry.id
                            return (
                              <li
                                key={
                                  workspaceKey ??
                                  entryKey ??
                                  `${provider.key}-workspace-${index}`
                                }
                                className={`rounded border px-3 py-2 text-xs ${
                                  entry.requiresReconnect
                                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/70 dark:bg-red-500/10 dark:text-red-200'
                                    : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <div className="font-medium text-zinc-700 dark:text-zinc-100">
                                      {entry.workspaceName}
                                    </div>
                                    <div className="text-zinc-600 dark:text-zinc-300">
                                      {entry.accountEmail ||
                                        'Delegated account'}
                                    </div>
                                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                      Workspace connection ID:{' '}
                                      {workspaceKey ?? 'Unknown'}
                                    </div>
                                    {entryKey ? (
                                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                        Connection ID: {entryKey}
                                      </div>
                                    ) : null}
                                    {entry.sharedByName ||
                                    entry.sharedByEmail ? (
                                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                        Shared by{' '}
                                        {entry.sharedByName ||
                                          'workspace admin'}
                                        {entry.sharedByEmail
                                          ? ` (${entry.sharedByEmail})`
                                          : ''}
                                      </div>
                                    ) : null}
                                    {entry.lastRefreshedAt ? (
                                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                        Last refreshed{' '}
                                        {new Date(
                                          entry.lastRefreshedAt
                                        ).toLocaleString()}
                                      </div>
                                    ) : null}
                                    {entry.requiresReconnect ? (
                                      <div className="text-[11px] font-semibold text-red-600 dark:text-red-300">
                                        Reconnect required by the credential
                                        owner.
                                      </div>
                                    ) : null}
                                  </div>
                                  {canPromote ? (
                                    <div className="mt-1 flex justify-end">
                                      <button
                                        onClick={() => setRemoveDialog(entry)}
                                        disabled={
                                          removeBusyId === entry.id ||
                                          busy ||
                                          promoting
                                        }
                                        className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Remove from workspace
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              )
            })
          )}
        </div>
      )}
      <ConfirmDialog
        isOpen={promoteDialogConnection !== null}
        title="Promote OAuth Connection"
        message="Share this connection with your workspace so other members can run workflows using it?"
        confirmText="Promote"
        onCancel={() => setPromoteDialogConnection(null)}
        onConfirm={async () => {
          const connection = promoteDialogConnection
          if (!connection) return
          const provider = connection.provider
          const connectionId = resolveConnectionKey(connection)
          if (!workspaceId) {
            setError('No active workspace selected for promotion')
            setPromoteDialogConnection(null)
            return
          }
          if (!connectionId) {
            setError('Missing connection identifier. Refresh and try again.')
            setPromoteDialogConnection(null)
            return
          }
          try {
            setPromoteBusyProvider(provider)
            setBusyConnectionId(connectionId)
            const promotion = await promoteConnection({
              workspaceId,
              provider,
              connectionId
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
              const nextPersonal = (prev?.personal ?? []).map((p) => {
                if (p.provider !== provider) return { ...p }
                const pKey = resolveConnectionKey(p)
                if (pKey === connectionId) {
                  return { ...p, requiresReconnect: false, isShared: true }
                }
                return { ...p }
              })
              const nextWorkspace = (prev?.workspace ?? [])
                .filter(
                  (entry) =>
                    entry.provider !== provider ||
                    (entry.id !== workspaceConnectionId &&
                      entry.workspaceConnectionId !== workspaceConnectionId)
                )
                .map((entry) => ({ ...entry }))

              const workspaceEntry: WorkspaceConnectionInfo = {
                scope: 'workspace',
                id: workspaceConnectionId,
                workspaceConnectionId,
                connectionId,
                connected: true,
                provider,
                accountEmail: connection.accountEmail,
                expiresAt: connection.expiresAt,
                lastRefreshedAt: connection.lastRefreshedAt,
                workspaceId,
                workspaceName,
                sharedByName,
                sharedByEmail,
                requiresReconnect: false,
                hasIncomingWebhook: false
              }

              const next: GroupedConnectionsSnapshot = {
                personal: nextPersonal,
                workspace: [...nextWorkspace, workspaceEntry]
              }
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
            setBusyConnectionId(null)
            setPromoteDialogConnection(null)
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

              const remainingSharedIds = new Set(
                nextWorkspace
                  .filter(
                    (workspaceEntry) =>
                      workspaceEntry.provider === entry.provider
                  )
                  .map((workspaceEntry) => {
                    if (typeof workspaceEntry.connectionId !== 'string') {
                      return null
                    }
                    const trimmed = workspaceEntry.connectionId.trim()
                    return trimmed.length > 0 ? trimmed : null
                  })
                  .filter((value): value is string => Boolean(value))
              )

              const nextPersonal = (prev?.personal ?? []).map((p) => {
                if (p.provider !== entry.provider) return { ...p }
                if (typeof p.connectionId !== 'string') {
                  return p.isShared ? { ...p, isShared: false } : { ...p }
                }
                const trimmed = p.connectionId.trim()
                if (!trimmed) {
                  return p.isShared ? { ...p, isShared: false } : { ...p }
                }
                const shouldBeShared = remainingSharedIds.has(trimmed)
                return p.isShared === shouldBeShared
                  ? { ...p }
                  : { ...p, isShared: shouldBeShared }
              })

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
            PROVIDERS.find(
              (p) => p.key === disconnectDialog.connection.provider
            )?.name ?? 'this provider'
          const connectionId =
            resolveConnectionKey(disconnectDialog.connection) ?? 'unknown id'
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
          return `Disconnecting this ${providerName} credential (ID ${connectionId}) will also remove the shared connection from ${workspaceText}. Existing workflows may stop working if they rely on it. Do you want to continue?`
        })()}
        confirmText="Remove credential"
        onCancel={() => {
          setDisconnectDialog(null)
        }}
        onConfirm={async () => {
          if (!disconnectDialog) {
            return
          }
          if (busyProvider === disconnectDialog.connection.provider) {
            return
          }
          const ok = await performDisconnect(
            disconnectDialog.connection,
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

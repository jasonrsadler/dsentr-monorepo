import { useCallback, useEffect, useMemo, useState } from 'react'

import { API_BASE_URL } from '@/lib/config'
import {
  OAuthProvider,
  ProviderConnectionSet,
  disconnectProvider,
  fetchConnections,
  refreshProvider,
  promoteConnection
} from '@/lib/oauthApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { normalizePlanTier, type PlanTier } from '@/lib/planTiers'
import ConfirmDialog from '@/components/UI/Dialog/ConfirmDialog'

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
      'Connect your Microsoft 365 account to run Outlook and Teams actions with delegated permissions managed by Dsentr.',
    scopes: 'offline_access User.Read'
  }
]

export default function IntegrationsTab({
  notice,
  onDismissNotice
}: IntegrationsTabProps) {
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const userPlan = useAuth((state) => state.user?.plan ?? null)
  const workspaceRole = currentWorkspace?.role ?? null
  const workspaceId = currentWorkspace?.workspace.id ?? null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<
    Record<OAuthProvider, ProviderConnectionSet>
  >({
    google: {
      personal: {
        scope: 'personal',
        id: null,
        connected: false,
        lastRefreshedAt: undefined,
        isShared: false
      },
      workspace: []
    },
    microsoft: {
      personal: {
        scope: 'personal',
        id: null,
        connected: false,
        lastRefreshedAt: undefined,
        isShared: false
      },
      workspace: []
    }
  })
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null)
  const [promoteDialogProvider, setPromoteDialogProvider] =
    useState<OAuthProvider | null>(null)
  const [promoteBusyProvider, setPromoteBusyProvider] =
    useState<OAuthProvider | null>(null)

  const planTier = useMemo<PlanTier>((): PlanTier => {
    return normalizePlanTier(
      currentWorkspace?.workspace.plan ?? userPlan ?? undefined
    )
  }, [currentWorkspace?.workspace.plan, userPlan])
  const isSoloPlan = planTier === 'solo'
  const isViewer = workspaceRole === 'viewer'
  const canPromote = workspaceRole === 'owner' || workspaceRole === 'admin'

  const openPlanSettings = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error((err as Error).message)
    }
  }, [])

  const loadConnections = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchConnections()
      setStatuses(data)
      setError(null)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load connections'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const data = await fetchConnections()
        if (!active) return
        setStatuses(data)
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
  }, [])

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

  const handleDisconnect = async (provider: OAuthProvider) => {
    setBusyProvider(provider)
    try {
      await disconnectProvider(provider)
      setStatuses((prev) => ({
        ...prev,
        [provider]: {
          personal: {
            scope: 'personal',
            id: null,
            connected: false,
            accountEmail: undefined,
            expiresAt: undefined,
            lastRefreshedAt: undefined,
            isShared: false
          },
          workspace: prev[provider]?.workspace ?? []
        }
      }))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to disconnect provider'
      setError(message)
    } finally {
      setBusyProvider(null)
    }
  }

  const handleRefresh = async (provider: OAuthProvider) => {
    setBusyProvider(provider)
    try {
      const updated = await refreshProvider(provider)
      setStatuses((prev) => ({
        ...prev,
        [provider]: {
          personal: {
            ...(prev[provider]?.personal ?? {
              scope: 'personal',
              id: null,
              connected: false,
              accountEmail: undefined,
              expiresAt: undefined,
              lastRefreshedAt: undefined,
              isShared: false
            }),
            connected: true,
            accountEmail: updated.accountEmail,
            expiresAt: updated.expiresAt,
            lastRefreshedAt: updated.lastRefreshedAt
          },
          workspace: prev[provider]?.workspace ?? []
        }
      }))
    } catch (err) {
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
          Dsentr manages the client credentials and refreshes access tokens
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
            const status = statuses[provider.key]
            const personal = status?.personal
            const connected = personal?.connected ?? false
            const accountEmail = personal?.accountEmail
            const expiresAt = personal?.expiresAt
            const lastRefreshedAt = personal?.lastRefreshedAt
            const busy = busyProvider === provider.key
            const promoting = promoteBusyProvider === provider.key
            const workspaceConnections = status?.workspace ?? []
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
                    <dd>{connected ? 'Connected' : 'Not connected'}</dd>
                  </div>
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
                  {workspaceConnections.length === 0 ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      No workspace connections have been shared yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {workspaceConnections.map((entry) => (
                        <li
                          key={entry.id}
                          className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"
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
          const personal = statuses[provider]?.personal
          if (!workspaceId) {
            setError('No active workspace selected for promotion')
            setPromoteDialogProvider(null)
            return
          }
          if (!personal?.id) {
            setError('Missing connection identifier. Refresh and try again.')
            setPromoteDialogProvider(null)
            return
          }
          try {
            setPromoteBusyProvider(provider)
            await promoteConnection({
              workspaceId,
              provider,
              connectionId: personal.id
            })
            await loadConnections()
            setError(null)
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
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'

import { API_BASE_URL } from '@/lib/config'
import {
  OAuthProvider,
  ProviderConnection,
  disconnectProvider,
  fetchConnections,
  refreshProvider
} from '@/lib/oauthApi'
import { useAuth } from '@/stores/auth'
import { normalizePlanTier, type PlanTier } from '@/lib/planTiers'

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
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<
    Record<OAuthProvider, ProviderConnection>
  >({
    google: { connected: false },
    microsoft: { connected: false }
  })
  const [busyProvider, setBusyProvider] = useState<OAuthProvider | null>(null)

  const planTier = useMemo<PlanTier>((): PlanTier => {
    return normalizePlanTier(user?.plan)
  }, [user?.plan])
  const isSoloPlan = planTier === 'solo'

  const openPlanSettings = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error((err as Error).message)
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchConnections()
      .then((data) => {
        if (!active) return
        setStatuses(data)
        setError(null)
      })
      .catch((err) => {
        if (!active) return
        setError(
          err instanceof Error ? err.message : 'Failed to load connections'
        )
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

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
    if (isSoloPlan) {
      return
    }
    window.location.href = `${API_BASE_URL}/api/oauth/${provider}/start`
  }

  const handleDisconnect = async (provider: OAuthProvider) => {
    setBusyProvider(provider)
    try {
      await disconnectProvider(provider)
      setStatuses((prev) => ({
        ...prev,
        [provider]: { connected: false }
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
        [provider]: updated
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
            const connected = status?.connected ?? false
            const accountEmail = status?.accountEmail
            const expiresAt = status?.expiresAt
            const busy = busyProvider === provider.key

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
                          disabled={busy}
                          className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Refresh token
                        </button>
                        <button
                          onClick={() => handleDisconnect(provider.key)}
                          disabled={busy}
                          className="rounded-md bg-red-500 px-3 py-1 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleConnect(provider.key)}
                        disabled={isSoloPlan}
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
                  <div className="flex items-center gap-2">
                    <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                      Scopes:
                    </dt>
                    <dd className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {provider.scopes}
                    </dd>
                  </div>
                </dl>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

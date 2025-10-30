import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  confirmAccountDeletion,
  getAccountDeletionSummary,
  type AccountDeletionConfirmPayload,
  type AccountDeletionSummary
} from '@/lib/accountDeletionApi'
import { useAuth } from '@/stores/auth'

type SummaryState = 'loading' | 'ready' | 'error'
type SubmitState = 'idle' | 'submitting' | 'success'

function formatDateTime(input: string) {
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    return input
  }
  return parsed.toLocaleString()
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

export default function ConfirmAccountDeletion() {
  const { token } = useParams<{ token: string }>()
  const [summaryState, setSummaryState] = useState<SummaryState>('loading')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [summary, setSummary] = useState<AccountDeletionSummary | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const logout = useAuth((state) => state.logout)
  const hasAuthenticatedUser = useAuth((state) => Boolean(state.user))

  useEffect(() => {
    if (!token) {
      setSummaryState('error')
      setError('This deletion link is invalid.')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const data = await getAccountDeletionSummary(token)
        if (cancelled) return
        setSummary(data)
        setEmail(data.email)
        setSummaryState('ready')
      } catch (err) {
        if (cancelled) return
        setSummaryState('error')
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load deletion details.'
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (submitState === 'success' && hasAuthenticatedUser) {
      logout().catch(() => undefined)
    }
  }, [submitState, logout, hasAuthenticatedUser])

  const requiresPassword = useMemo(() => {
    if (!summary) return true
    return summary.requires_password
  }, [summary])

  const counts = summary?.counts

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!summary || !token) return
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Enter the email address associated with this account.')
      return
    }
    if (requiresPassword && !password.trim()) {
      setError('Enter your password to continue.')
      return
    }

    const payload: AccountDeletionConfirmPayload = {
      token,
      email: trimmedEmail
    }
    if (requiresPassword) {
      payload.password = password
    }

    setSubmitState('submitting')
    setError(null)
    try {
      await confirmAccountDeletion(payload)
      setSubmitState('success')
    } catch (err) {
      setSubmitState('idle')
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to confirm account deletion.'
      )
    }
  }

  if (summaryState === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-50 px-4 py-16 dark:bg-zinc-900">
        <div className="mx-auto max-w-xl rounded-lg border border-zinc-200 bg-white p-6 text-center shadow dark:border-zinc-700 dark:bg-zinc-950">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Loading deletion details…
          </p>
        </div>
      </div>
    )
  }

  if (summaryState === 'error' || !summary) {
    return (
      <div className="min-h-screen bg-zinc-50 px-4 py-16 dark:bg-zinc-900">
        <div className="mx-auto max-w-xl rounded-lg border border-red-400 bg-red-50 p-6 shadow dark:border-red-500 dark:bg-red-900/20">
          <h1 className="text-lg font-semibold text-red-700 dark:text-red-200">
            Unable to continue
          </h1>
          <p className="mt-2 text-sm text-red-700 dark:text-red-200">
            {error || 'This deletion link is no longer valid.'}
          </p>
        </div>
      </div>
    )
  }

  const stripeMessage = summary.stripe.has_active_subscription
    ? 'An active Stripe subscription was detected and will be cancelled immediately when you confirm.'
    : summary.stripe.has_customer
      ? 'No active Stripe subscription is currently associated with this account.'
      : 'No Stripe customer is linked to this account.'

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-16 dark:bg-zinc-900">
      <div className="mx-auto max-w-3xl space-y-8 rounded-lg border border-zinc-200 bg-white p-8 shadow dark:border-zinc-700 dark:bg-zinc-950">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Confirm account deletion
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This action permanently removes your Dsentr account and all related
            data.
            <span className="block">
              Stripe subscriptions will be cancelled and collaborators lose
              access immediately.
            </span>
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Deletion requested: {formatDateTime(summary.requested_at)} · Link
            expires:
            <span className="block sm:inline">
              {formatDateTime(summary.expires_at)}
            </span>
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <DataCard label="Workflows" value={counts?.workflows ?? 0} />
          <DataCard
            label="Owned workspaces"
            value={counts?.owned_workspaces ?? 0}
          />
          <DataCard
            label="Member workspaces"
            value={counts?.member_workspaces ?? 0}
          />
          <DataCard label="Workflow runs" value={counts?.workflow_runs ?? 0} />
          <DataCard label="Workflow logs" value={counts?.workflow_logs ?? 0} />
          <DataCard label="Secrets" value={counts?.secrets ?? 0} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            Additional data removed
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {summary.additional_data.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            Effects on collaborators
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {summary.system_impacts.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500 dark:bg-amber-900/20 dark:text-amber-200">
          {stripeMessage}
        </section>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Confirm your email
            </label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-900"
              required
            />
          </div>

          {requiresPassword ? (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Confirm your password
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-900"
                required
              />
            </div>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              This account was created with an OAuth provider. Reconfirming your
              email verifies you still control the mailbox. You can complete the
              deletion without reauthenticating with the provider.
            </p>
          )}

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          {submitState === 'success' ? (
            <p className="text-sm text-emerald-600">
              Your deletion has been confirmed. Data removal is underway.
              <span className="block sm:inline">
                {summary.compliance_notice}
              </span>
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={submitState === 'submitting' || submitState === 'success'}
          >
            {submitState === 'submitting'
              ? 'Deleting account…'
              : submitState === 'success'
                ? 'Account deleted'
                : 'Confirm deletion'}
          </button>
        </form>

        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {summary.compliance_notice}
        </p>
      </div>
    </div>
  )
}

type DataCardProps = {
  label: string
  value: number
}

function DataCard({ label, value }: DataCardProps) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {formatNumber(value)}
      </p>
    </div>
  )
}

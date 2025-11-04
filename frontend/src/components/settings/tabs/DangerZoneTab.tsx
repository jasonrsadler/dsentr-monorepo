import { FormEvent, useMemo, useState } from 'react'
import {
  requestAccountDeletion,
  type AccountDeletionRequestPayload
} from '@/lib/accountDeletionApi'
import { useAuth } from '@/stores/auth'

const ADDITIONAL_DATA = [
  'Workflow run history, execution logs, and queued jobs will be removed.',
  'Stored API keys, personal secrets, and workspace credential caches are deleted.',
  'User OAuth tokens and workspace-level integrations tied to this owner are revoked.',
  'Pending workspace invitations and member audit entries are purged.',
  'Webhook replay buffers and workflow scheduling metadata are discarded.'
]

const SYSTEM_IMPACTS = [
  'Collaborators immediately lose access to workflows you own.',
  'Active and scheduled automations stop because the workflows are deleted.',
  'Shared workspace credentials and integrations connected through your account are revoked.',
  'Any active Stripe subscriptions tied to this user are cancelled at once.'
]

export default function DangerZoneTab() {
  const { user } = useAuth()
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>(
    'idle'
  )
  const [error, setError] = useState<string | null>(null)

  const requiresPassword = useMemo(() => {
    if (!user) return true
    return !user.oauthProvider || user.oauthProvider === 'email'
  }, [user])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Enter the email address associated with your account.')
      return
    }
    if (requiresPassword && !password.trim()) {
      setError('Enter your password to continue.')
      return
    }

    const payload: AccountDeletionRequestPayload = {
      email: trimmedEmail
    }
    if (requiresPassword) {
      payload.password = password
    }

    setStatus('submitting')
    setError(null)
    try {
      await requestAccountDeletion(payload)
      setStatus('success')
    } catch (err) {
      setStatus('idle')
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to request account deletion.'
      )
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-red-400 bg-red-50 p-6 text-red-900">
        <h2 className="text-lg font-semibold">Danger zone</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Deleting your DSentr account is permanent. All workflows, data, and
          workspace memberships you own will be removed immediately. Stripe
          subscriptions are cancelled right away.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Although we delete operational data, DSentr retains a minimal,
          non-public audit record to satisfy regulatory and legal requests.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="font-medium text-sm uppercase tracking-wide text-red-700">
          What will be deleted
        </h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          {ADDITIONAL_DATA.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium text-sm uppercase tracking-wide text-red-700">
          Effects on others
        </h3>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          {SYSTEM_IMPACTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Confirm your email
          </label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-900"
            required
          />
        </div>

        {requiresPassword ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Confirm your password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-zinc-700 dark:bg-zinc-900"
              required
            />
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This account was created with an OAuth provider. Re-entering your
            email confirms you still control the mailbox. You&apos;ll receive a
            confirmation email to finish the process.
          </p>
        )}

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {status === 'success' ? (
          <p className="text-sm text-emerald-600">
            We&apos;ve sent a confirmation link to {email.trim()}. Follow the
            email to finish deleting your account.
          </p>
        ) : null}

        <button
          type="submit"
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={status === 'submitting'}
        >
          {status === 'submitting' ? 'Sending email…' : 'Send deletion email'}
        </button>
      </form>
    </div>
  )
}

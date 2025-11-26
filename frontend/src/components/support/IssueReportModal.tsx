import { FormEvent, useEffect, useState } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'

import { submitIssueReport } from '@/lib/supportApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'

type Props = {
  open: boolean
  onClose: () => void
}

export default function IssueReportModal({ open, onClose }: Props) {
  const user = useAuth((state) => state.user)
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setDescription('')
      setError(null)
      setStatus(null)
      setIsSubmitting(false)
    }
  }, [open])

  if (!open || !user) return null

  const workspaceName = currentWorkspace
    ? currentWorkspace.workspace.name?.trim() || 'Unnamed workspace'
    : 'Personal workspace'

  const workspacePlan = currentWorkspace?.workspace.plan || user.plan || 'solo'

  const workspaceRole = currentWorkspace?.role ?? null

  const submitterName =
    `${user.first_name} ${user.last_name}`.trim() || user.email

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = description.trim()
    if (!trimmed) {
      setError('Please describe the issue you are experiencing.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setStatus(null)

    try {
      await submitIssueReport({
        description: trimmed,
        workspaceId: currentWorkspace?.workspace.id ?? null
      })
      setStatus(
        'Thanks for your report. We will use your account and workspace details only to resolve this issue.'
      )
      setDescription('')
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to submit your issue right now.'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-report-title"
        className="relative w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="issue-report-title"
              className="text-xl font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Report an issue
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Share what went wrong. We capture your account and workspace
              details so our team can troubleshoot quickly.
            </p>
          </div>
        </header>

        <section className="mt-6 grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
          <div className="flex items-start justify-between gap-4">
            <div className="font-semibold">Submitting as</div>
            <div className="text-right">
              <div className="font-semibold">{submitterName}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {user.email}
              </div>
            </div>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="font-semibold">Workspace</div>
            <div className="text-right">
              <div className="font-semibold">{workspaceName}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Plan: {workspacePlan}
                {workspaceRole ? ` • Role: ${workspaceRole}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
            <Info size={16} className="mt-0.5 shrink-0" />
            <p>
              All information submitted through this form is used only to
              investigate and resolve your issue.
            </p>
          </div>
        </section>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="issue-description"
              className="block text-sm font-medium text-zinc-800 dark:text-zinc-100"
            >
              Describe the issue
            </label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Include steps to reproduce, the page you were on, and anything
              that looks out of place.
            </p>
            <textarea
              id="issue-description"
              rows={5}
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-75 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/40"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/30 dark:text-red-100"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {status ? (
            <div
              role="status"
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/30 dark:text-emerald-100"
            >
              {status}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit issue'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

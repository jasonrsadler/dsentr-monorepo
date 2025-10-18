import { FormEvent, useEffect, useState } from 'react'
import { changeUserPassword } from '@/lib/authApi'
import { useAuth } from '@/stores/auth'

type Props = {
  open: boolean
  onClose: () => void
}

type ToastState = {
  type: 'success' | 'error'
  message: string
}

export default function ProfileModal({ open, onClose }: Props) {
  const user = useAuth((state) => state.user)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    if (!open) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setIsSubmitting(false)
      setToast(null)
    }
  }, [open])

  if (!open || !user) return null

  const fullName = `${user.first_name} ${user.last_name}`.trim()
  const toastVariantClass =
    toast?.type === 'error'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
  const toastClassName = [
    'mt-4 rounded-md px-4 py-2 text-sm',
    toastVariantClass
  ].join(' ')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newPassword || !confirmPassword) {
      setToast({
        type: 'error',
        message: 'Please enter and confirm your new password.'
      })
      return
    }
    if (newPassword !== confirmPassword) {
      setToast({
        type: 'error',
        message: 'New password entries do not match.'
      })
      return
    }

    setIsSubmitting(true)
    setToast(null)

    try {
      const response = await changeUserPassword({
        currentPassword,
        newPassword
      })
      const message =
        (typeof response === 'object' && response && 'message' in response
          ? (response as { message?: string }).message
          : undefined) ?? 'Password updated successfully.'
      setToast({
        type: 'success',
        message
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to change password. Please try again.'
      setToast({
        type: 'error',
        message
      })
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
        aria-labelledby="profile-modal-title"
        className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-lg border border-zinc-200 dark:border-zinc-700 p-6"
      >
        <h2
          id="profile-modal-title"
          className="text-xl font-semibold text-zinc-900 dark:text-zinc-100"
        >
          Profile
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          Manage your personal account details and credentials. These settings
          apply to you regardless of the active workspace or plan.
        </p>

        {toast ? (
          <div
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={toastClassName}
          >
            {toast.message}
          </div>
        ) : null}

        <section className="mt-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide">
            Profile details
          </h3>
          <dl className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Name</dt>
              <dd className="text-right font-medium">
                {fullName || 'Unknown user'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Email</dt>
              <dd className="text-right font-medium break-all">{user.email}</dd>
            </div>
            {user.companyName ? (
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500 dark:text-zinc-400">Company</dt>
                <dd className="text-right font-medium break-all">
                  {user.companyName}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="current-password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>

          <div>
            <label
              htmlFor="new-password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>

        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-4 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Close
        </button>
      </div>
    </div>
  )
}

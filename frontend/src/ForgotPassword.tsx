import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FormButton } from './components/UI/Buttons/FormButton'
import ForgotPasswordIcon from './assets/svg-components/ForgotPasswordIcon'
import { API_BASE_URL } from './lib'
import { getCsrfToken } from './lib/csrfCache'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { MetaTags } from '@/components/MetaTags'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const csrfToken = await getCsrfToken()
      const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ email }),
        credentials: 'include'
      })
      if (res.ok) {
        setSuccess(true)
      } else {
        const data = await res.json()
        setError(data?.error || 'Something went wrong')
      }
    } catch {
      setError('Network error')
    }
  }

  return (
    <>
      <MetaTags
        title="Forgot password – Dsentr"
        description="Request a secure link to reset your Dsentr password."
      />
      <MarketingShell maxWidthClassName="max-w-4xl">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
          <div className="space-y-8">
            <BrandHero
              title="Reset your access"
              description="Enter the email you use for Dsentr and we’ll send you a secure link to create a new password."
              kicker="Password reset"
              align="left"
            />
            <ul className="grid gap-3 rounded-2xl border border-zinc-200/60 bg-white/60 p-6 text-left text-sm leading-relaxed text-zinc-600 shadow-sm dark:border-white/10 dark:bg-zinc-900/60 dark:text-zinc-300">
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/10 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                  1
                </span>
                Request the reset link with your email address.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/10 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                  2
                </span>
                Check your inbox for a Dsentr message titled “Reset your
                password”.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/10 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                  3
                </span>
                Follow the secure link within 15 minutes to complete the reset.
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-zinc-200/60 bg-white/70 p-8 shadow-lg shadow-indigo-500/5 dark:border-white/10 dark:bg-zinc-900/80">
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <ForgotPasswordIcon />
              </span>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Forgot your password?
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                We&apos;ll send a secure link so you can set a new one in
                seconds.
              </p>
            </div>

            {success ? (
              <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/80 p-4 text-sm font-medium text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-200">
                ✅ Reset link sent! Please check your email.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="text-left">
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
                  >
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-2 block w-full rounded-xl border border-zinc-300/70 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-red-200/60 bg-red-50/80 px-3 py-2 text-sm text-red-600 dark:border-red-400/30 dark:bg-red-950/20 dark:text-red-200">
                    {error}
                  </div>
                )}
                <FormButton className="w-full justify-center">
                  Send reset link
                </FormButton>
              </form>
            )}

            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="text-sm font-medium text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400"
              >
                Remembered your password? Log in
              </Link>
            </div>
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

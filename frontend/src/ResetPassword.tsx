import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FormButton } from './components/ui/buttons/FormButton'
import LockIcon from '@/assets/svg-components/LockIcon'
import HidePasswordIcon from './assets/svg-components/HidePasswordIcon'
import ShowPasswordIcon from './assets/svg-components/ShowPasswordIcon'
import { API_BASE_URL } from './lib'
import { getCsrfToken } from './lib/csrfCache'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { MetaTags } from '@/components/MetaTags'

const TOKEN_VERIFY_URL = `${API_BASE_URL}/api/auth/verify-reset-token`
const RESET_PASSWORD_URL = `${API_BASE_URL}/api/auth/reset-password`

function evaluatePasswordStrength(password: string) {
  let score = 0
  if (password.length >= 8) score++
  if (/[A-Z]/.test(password)) score++
  if (/[a-z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[\W_]/.test(password)) score++

  if (score <= 2) return { label: 'Weak', color: 'text-red-500' }
  if (score === 3) return { label: 'Moderate', color: 'text-yellow-500' }
  return { label: 'Strong', color: 'text-green-500' }
}

export default function ResetPassword() {
  const navigate = useNavigate()
  const { token } = useParams<{ token: string }>()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)

  const strength = evaluatePasswordStrength(password)

  useEffect(() => {
    if (!token) {
      setTokenValid(false)
      setError('Missing reset token.')
      return
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(token)) {
      setTokenValid(false)
      setError('Invalid token format.')
      return
    }

    const checkToken = async () => {
      try {
        const res = await fetch(`${TOKEN_VERIFY_URL}/${token}`)
        if (res.ok) {
          setTokenValid(true)
        } else {
          setTokenValid(false)
          const data = await res.json()
          setError(data.message || 'Invalid or expired token.')
        }
      } catch (err: any) {
        setTokenValid(false)
        setError(err.message || 'Something went wrong while verifying token.')
      }
    }

    checkToken()
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (!password || !confirm) {
      setError('Please fill in both fields.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const csrfToken = await getCsrfToken()
      const res = await fetch(RESET_PASSWORD_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ password, token }),
        credentials: 'include'
      })
      const data = await res.json()
      if (res.ok) {
        setMessage('Password successfully reset! Redirecting to login...')
        if (import.meta.env.MODE === 'test') {
          navigate('/login')
        } else {
          setTimeout(() => navigate('/login'), 2500)
        }
      } else {
        setError(data.message || 'Reset failed.')
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
      setLoading(false)
    }
  }

  return (
    <>
      <MetaTags
        title="Reset password - DSentr"
        description="Set a new password to regain access to your DSentr account."
      />
      <MarketingShell compact maxWidthClassName="max-w-4xl">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
          <div className="space-y-8">
            <BrandHero
              title="Create a new password"
              description="For your security, reset links expire quickly. Choose a strong password to continue where you left off."
              kicker="Account recovery"
              align="left"
            />
            <div className="rounded-2xl border border-indigo-200/40 bg-indigo-500/5 p-6 text-left text-sm leading-relaxed text-zinc-700 shadow-sm dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-zinc-200">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                Password tips
              </p>
              <ul className="mt-3 space-y-2 list-disc pl-5">
                <li>
                  Use at least 12 characters with a mix of letters, numbers, and
                  symbols.
                </li>
                <li>
                  Avoid reusing passwords from other tools or shared accounts.
                </li>
                <li>Store your password securely using a password manager.</li>
              </ul>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200/60 bg-white/80 p-8 shadow-lg shadow-indigo-500/5 dark:border-white/10 dark:bg-zinc-900/80">
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <LockIcon className="h-7 w-7" />
              </span>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Reset your password
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Choose a new password to regain access.
              </p>
            </div>

            {tokenValid === null ? (
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-300">
                Verifying token...
              </p>
            ) : tokenValid === false ? (
              <p className="text-center text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="newPasswordTextBox"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
                  >
                    New password
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="newPasswordTextBox"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-zinc-300/70 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-3 flex items-center text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      {showPassword ? (
                        <HidePasswordIcon />
                      ) : (
                        <ShowPasswordIcon />
                      )}
                    </button>
                  </div>
                  {password && (
                    <div className="mt-3 space-y-1">
                      <div className="h-1 rounded bg-zinc-300 dark:bg-zinc-700">
                        <div
                          className={`h-1 rounded transition-all duration-300 ease-in-out ${strength.label === 'Weak'
                            ? 'bg-red-500 w-1/3'
                            : strength.label === 'Moderate'
                              ? 'bg-yellow-500 w-2/3'
                              : 'bg-green-500 w-full'
                            }`}
                        />
                      </div>
                      <p className={`text-xs ${strength.color}`}>
                        Password strength: {strength.label}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="confirmNewPasswordTextbox"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
                  >
                    Confirm new password
                  </label>
                  <div className="relative mt-2">
                    <input
                      id="confirmNewPasswordTextbox"
                      type={showConfirm ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-zinc-300/70 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute inset-y-0 right-3 flex items-center text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      {showConfirm ? (
                        <HidePasswordIcon />
                      ) : (
                        <ShowPasswordIcon />
                      )}
                    </button>
                  </div>
                </div>

                <FormButton
                  disabled={loading}
                  className="w-full justify-center"
                >
                  {loading ? 'Resetting...' : 'Reset password'}
                </FormButton>

                {error && (
                  <p className="text-center text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}
                {message && (
                  <p className="text-center text-sm text-emerald-600 dark:text-emerald-400">
                    {message}
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

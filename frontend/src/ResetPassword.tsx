import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FormButton } from './components/ui/buttons/FormButton'
import LockIcon from '@/assets/svg-components/LockIcon'
import HidePasswordIcon from './assets/svg-components/HidePasswordIcon'
import ShowPasswordIcon from './assets/svg-components/ShowPasswordIcon'
import { API_BASE_URL } from './lib'
import { getCsrfToken } from './lib/csrfCache'

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
    <div className="min-h-[calc(100vh-120px)] bg-white dark:bg-zinc-900 flex items-center justify-center px-4 transition-colors">
      <div className="max-w-md w-full bg-zinc-50 dark:bg-zinc-800 p-6 md:p-8 rounded-lg shadow-md relative">
        <h2 className="text-2xl font-bold text-center text-zinc-900 dark:text-zinc-100 mb-2">
          Reset Your Password
        </h2>
        <LockIcon className="w-12 h-12 mx-auto text-primary text-indigo-600 dark:text-indigo-400" />

        <p className="text-sm text-center text-zinc-600 dark:text-zinc-400 mb-4">
          Choose a new password to regain access.
        </p>

        {tokenValid === null ? (
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Verifying token...
          </p>
        ) : tokenValid === false ? (
          <p className="text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="newPasswordTextBox"
                className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
              >
                New Password
              </label>
              <div className="relative">
                <input
                  id="newPasswordTextBox"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 mt-1 text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-2.5 right-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {showPassword ? <HidePasswordIcon /> : <ShowPasswordIcon />}
                </button>
              </div>
              {password && (
                <div className="mt-2">
                  <div className="h-1 rounded bg-zinc-300 dark:bg-zinc-700 overflow-hidden">
                    <div
                      className={`h-1 transition-all duration-300 ease-in-out ${
                        strength.label === 'Weak'
                          ? 'bg-red-500 w-1/3'
                          : strength.label === 'Moderate'
                            ? 'bg-yellow-500 w-2/3'
                            : 'bg-green-500 w-full'
                      }`}
                    />
                  </div>
                  <p className={`mt-1 text-xs ${strength.color}`}>
                    Password Strength: {strength.label}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="confirmNewPasswordTextbox"
                className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  id="confirmNewPasswordTextbox"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="w-full border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 mt-1 text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute top-2.5 right-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {showConfirm ? <HidePasswordIcon /> : <ShowPasswordIcon />}
                </button>
              </div>
            </div>

            <FormButton
              disabled={loading}
              className={`${
                loading
                  ? 'bg-indigo-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500'
              } w-full`}
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </FormButton>

            {error && (
              <p className="text-red-600 dark:text-red-400 text-sm text-center mt-2">
                {error}
              </p>
            )}
            {message && (
              <p className="text-green-600 dark:text-green-400 text-sm text-center mt-2">
                {message}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}

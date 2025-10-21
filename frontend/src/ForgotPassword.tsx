import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FormButton } from './components/ui/buttons/FormButton'
import ForgotPasswordIcon from './assets/svg-components/ForgotPasswordIcon'
import { API_BASE_URL } from './lib'
import { getCsrfToken } from './lib/csrfCache'

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
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-900 px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <ForgotPasswordIcon />
          <h2 className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">
            Forgot Your Password?
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            It happens! Just type in your email below and we'll send you a link
            to reset your password. No stress, no judgment.
          </p>
        </div>

        {success ? (
          <div className="rounded-md bg-green-50 dark:bg-green-900/30 p-4 text-green-800 dark:text-green-300 text-sm text-center border border-green-200 dark:border-green-700">
            ✅ Reset link sent! Please check your email.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-white"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
            <FormButton>Send Reset Link</FormButton>
          </form>
        )}

        <div className="text-center">
          <Link
            to="/login"
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:underline"
          >
            Remembered your password? Log in
          </Link>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import { API_BASE_URL, loginWithEmail } from '@/lib'
import { FormButton } from '@/components/UI/Buttons/FormButton'
import LoginIcon from '@/assets/svg-components/LoginIcon'
import GoogleLoginButton from './components/GoogleLoginButton'
import GithubLoginButton from './components/GithubLoginButton'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const { user, isLoading, login } = useAuth()

  useEffect(() => {
    if (!isLoading && user) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, isLoading, navigate])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const err = params.get('error')
    if (err) {
      setError(decodeURIComponent(err))

      const newParams = new URLSearchParams(location.search)
      newParams.delete('error')

      const newUrl =
        window.location.pathname +
        (newParams.toString() ? `?${newParams.toString()}` : '')

      window.history.replaceState(null, '', newUrl)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const res = await loginWithEmail({ email, password, remember })
    if (res.success && res.data?.user) {
      login(res.data.user)
      navigate('/dashboard')
    } else {
      setError(res.message || 'Login failed')
    }
  }

  if (isLoading || user) return null

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-900 px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <LoginIcon />
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Login to Dsentr
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div>
            <label
              htmlFor="emailField"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Email
            </label>
            <input
              id="emailField"
              type="email"
              className="w-full mt-1 px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label
              htmlFor="passwordField"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Password
            </label>
            <input
              id="passwordField"
              type="password"
              className="w-full mt-1 px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="accent-indigo-500"
              />
              Remember me
            </label>
            <a
              href="/forgot-password"
              className="text-sm text-indigo-500 hover:underline"
            >
              Forgot password?
            </a>
          </div>

          {error && (
            <div
              className="text-red-500 text-sm text-center"
              data-testid="loginError"
            >
              {error}
            </div>
          )}

          <FormButton>Login</FormButton>
        </form>

        <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-6">
          Or continue with
        </div>
        <div className="flex flex-col gap-3">
          <GoogleLoginButton
            className="w-full h-full"
            onClick={() => {
              window.location.href = `${API_BASE_URL}/api/auth/google-login`
            }}
          />
          <GithubLoginButton
            className="w-full h-full"
            onClick={() => {
              window.location.href = `${API_BASE_URL}/api/auth/github-login`
            }}
            text="Login with GitHub"
          />
        </div>
      </div>
    </div>
  )
}

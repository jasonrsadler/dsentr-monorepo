import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import { API_BASE_URL, loginWithEmail } from '@/lib'
import { acceptInviteToken, declineInviteToken } from '@/lib/orgWorkspaceApi'
import { FormButton } from '@/components/ui/buttons/FormButton'
import LoginIcon from '@/assets/svg-components/LoginIcon'
import GoogleLoginButton from './components/GoogleLoginButton'
import GithubLoginButton from './components/GithubLoginButton'

type InvitePreviewResponse = {
  success: boolean
  invitation: {
    workspace_id: string
    workspace_name?: string
    email: string
    role: string
  } | null
  expired: boolean
  revoked: boolean
  accepted: boolean
  declined?: boolean
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState('')
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [invitePreview, setInvitePreview] =
    useState<InvitePreviewResponse | null>(null)
  const [inviteStatus, setInviteStatus] = useState<
    'idle' | 'loading' | 'ready' | 'invalid'
  >('idle')
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [inviteActionLoading, setInviteActionLoading] = useState<
    'accept' | 'decline' | null
  >(null)
  const [inviteActionError, setInviteActionError] = useState<string | null>(
    null
  )
  const [inviteDecisionResult, setInviteDecisionResult] = useState<
    'declined' | null
  >(null)
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null)

  const navigate = useNavigate()
  const routerLocation = useLocation()

  const { user, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading && user) {
      if (
        inviteToken &&
        inviteStatus === 'ready' &&
        !inviteDecisionResult &&
        invitePreview?.invitation
      ) {
        setInviteModalOpen(true)
        return
      }
      if (!inviteModalOpen) {
        navigate('/dashboard', { replace: true })
      }
    }
  }, [
    user,
    isLoading,
    navigate,
    inviteToken,
    inviteStatus,
    inviteModalOpen,
    inviteDecisionResult,
    invitePreview
  ])

  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search)
    const err = params.get('error')
    if (err) {
      setError(decodeURIComponent(err))

      const newParams = new URLSearchParams(routerLocation.search)
      newParams.delete('error')

      const newUrl =
        window.location.pathname +
        (newParams.toString() ? `?${newParams.toString()}` : '')

      window.history.replaceState(null, '', newUrl)
    }
  }, [routerLocation.search])

  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search)
    const token = params.get('invite')
    if (token) {
      setInviteToken(token)
    } else {
      setInviteToken(null)
      setInvitePreview(null)
      setInviteStatus('idle')
      setInviteModalOpen(false)
      setInviteActionLoading(null)
      setInviteActionError(null)
      setInviteDecisionResult(null)
      setInviteFeedback(null)
    }
  }, [routerLocation.search])

  useEffect(() => {
    if (!inviteToken) {
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setInviteStatus('loading')
    setInvitePreview(null)
    setInviteActionError(null)
    setInviteDecisionResult(null)
    setInviteFeedback(null)

    const loadPreview = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/invites/${encodeURIComponent(inviteToken)}`,
          { signal: controller.signal }
        )
        if (!res.ok) {
          throw new Error('Invite lookup failed')
        }
        const data: InvitePreviewResponse = await res.json()
        if (cancelled) return

        const invalid =
          !data.success ||
          !data.invitation ||
          data.expired ||
          data.revoked ||
          data.accepted ||
          Boolean(data.declined)

        if (invalid) {
          setInviteStatus('invalid')
          setInvitePreview(null)
          return
        }

        setInvitePreview(data)
        setInviteStatus('ready')
      } catch (err: any) {
        if (cancelled || err?.name === 'AbortError') return
        setInviteStatus('invalid')
        setInvitePreview(null)
      }
    }

    loadPreview()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [inviteToken])

  const formattedInviteRole = useMemo(() => {
    const role = invitePreview?.invitation?.role
    if (!role) return ''
    const normalized = role.toLowerCase()
    return normalized.charAt(0).toUpperCase() + normalized.slice(1)
  }, [invitePreview])

  const clearInviteQuery = () => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('invite')) return
    params.delete('invite')
    const newUrl =
      window.location.pathname +
      (params.toString() ? `?${params.toString()}` : '')
    window.history.replaceState(null, '', newUrl)
  }

  const finalizeInviteNavigation = () => {
    clearInviteQuery()
    setInviteModalOpen(false)
    setInviteToken(null)
    setInvitePreview(null)
    setInviteStatus('idle')
    navigate('/dashboard')
  }

  const handleInviteAccept = async () => {
    if (!inviteToken) return
    setInviteActionLoading('accept')
    setInviteActionError(null)
    try {
      await acceptInviteToken(inviteToken)
      finalizeInviteNavigation()
    } catch (err: any) {
      const message =
        err instanceof Error ? err.message : 'Failed to accept invitation'
      setInviteActionError(message)
    } finally {
      setInviteActionLoading(null)
    }
  }

  const handleInviteDecline = async () => {
    if (!inviteToken) return
    setInviteActionLoading('decline')
    setInviteActionError(null)
    try {
      await declineInviteToken(inviteToken)
      setInviteDecisionResult('declined')
      setInviteFeedback('Invite declined')
    } catch (err: any) {
      const message =
        err instanceof Error ? err.message : 'Failed to decline invitation'
      setInviteActionError(message)
    } finally {
      setInviteActionLoading(null)
    }
  }

  const handleInviteDismiss = () => {
    finalizeInviteNavigation()
  }

  const acceptLoading = inviteActionLoading === 'accept'
  const declineLoading = inviteActionLoading === 'decline'
  const invitation = invitePreview?.invitation ?? null
  const workspaceLabel =
    invitation?.workspace_name?.trim() || invitation?.workspace_id || ''
  const showInviteModal = inviteModalOpen && Boolean(invitation)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const res = await loginWithEmail({ email, password, remember })
    if (res.success && res.data?.user) {
      if (
        inviteToken &&
        inviteStatus === 'ready' &&
        invitePreview?.invitation
      ) {
        setInviteActionError(null)
        setInviteActionLoading(null)
        setInviteDecisionResult(null)
        setInviteFeedback(null)
        setInviteModalOpen(true)
        return
      }

      clearInviteQuery()
      navigate('/dashboard')
    } else {
      setError(res.message || 'Login failed')
    }
  }

  if (isLoading) return null

  if (user && !showInviteModal) return null

  return (
    <>
      {showInviteModal && invitation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Confirm workspace invitation
            </h2>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
              You are about to join workspace
              <span className="font-medium"> {workspaceLabel}</span>
              {formattedInviteRole && (
                <span>
                  {' '}
                  as <span className="font-medium">{formattedInviteRole}</span>
                </span>
              )}
              .
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Invitation sent to {invitation.email}
            </p>
            {inviteActionError && (
              <div className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">
                {inviteActionError}
              </div>
            )}
            {inviteFeedback && (
              <div className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-600 dark:bg-emerald-950/40 dark:text-emerald-200">
                {inviteFeedback}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              {inviteDecisionResult === 'declined' ? (
                <button
                  type="button"
                  onClick={handleInviteDismiss}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500"
                >
                  Continue
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleInviteDecline}
                    disabled={declineLoading}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {declineLoading ? 'Declining…' : 'Decline'}
                  </button>
                  <button
                    type="button"
                    onClick={handleInviteAccept}
                    disabled={acceptLoading}
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {acceptLoading ? 'Accepting…' : 'Accept'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!user && (
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
      )}
    </>
  )
}

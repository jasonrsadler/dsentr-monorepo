import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import { API_BASE_URL, loginWithEmail } from '@/lib'
import { acceptInviteToken, declineInviteToken } from '@/lib/orgWorkspaceApi'
import { FormButton } from '@/components/ui/buttons/FormButton'
import LoginIcon from '@/assets/svg-components/LoginIcon'
import GoogleLoginButton from './components/GoogleLoginButton'
import GithubLoginButton from './components/GithubLoginButton'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { MetaTags } from '@/components/MetaTags'

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
      if (res.code === 'unverified_email') {
        navigate('/check-email?email=' + email)
        return
      }

      setError(res.message || 'Login failed')
    }
  }

  if (isLoading) return null

  if (user && !showInviteModal) return null

  return (
    <>
      <MetaTags
        title="Log in – DSentr"
        description="Sign in to DSentr to build, launch, and manage your automated workflows."
      />
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
        <MarketingShell compact maxWidthClassName="max-w-6xl">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
            <div className="hidden space-y-8 lg:block">
              <BrandHero
                title="Welcome back"
                description="Sign in to continue orchestrating your workflows, monitoring run history, and collaborating with your team."
                kicker="Sign in"
                align="left"
              />

              <div className="grid gap-4 rounded-2xl border border-zinc-200/60 bg-white/70 p-6 text-left text-sm leading-relaxed text-zinc-600 shadow-sm dark:border-white/10 dark:bg-zinc-900/70 dark:text-zinc-300">
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  Inside DSentr you can:
                </p>
                <ul className="grid gap-3">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/10 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                      1
                    </span>
                    Design visual workflows with modular nodes and live
                    previews.
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/10 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                      2
                    </span>
                    Manage workspace roles, credentials, and audit trails in one
                    place.
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/10 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                      3
                    </span>
                    Monitor execution with real-time logs and alerting.
                  </li>
                </ul>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200/60 bg-white/80 p-8 shadow-lg shadow-indigo-500/5 dark:border-white/10 dark:bg-zinc-900/80">
              <div className="mb-6 flex flex-col items-center gap-3 text-center">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <LoginIcon />
                </span>
                <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  Log in to DSentr
                </h1>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5 text-left">
                <div>
                  <label
                    htmlFor="emailField"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
                  >
                    Email
                  </label>
                  <input
                    id="emailField"
                    type="email"
                    className="mt-2 w-full rounded-xl border border-zinc-300/70 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="passwordField"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
                  >
                    Password
                  </label>
                  <input
                    id="passwordField"
                    type="password"
                    className="mt-2 w-full rounded-xl border border-zinc-300/70 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
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
                    className="font-medium text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400"
                  >
                    Forgot password?
                  </a>
                </div>

                {error && (
                  <div
                    className="rounded-lg border border-red-200/60 bg-red-50/80 px-3 py-2 text-sm text-red-600 dark:border-red-400/30 dark:bg-red-950/20 dark:text-red-200"
                    data-testid="loginError"
                  >
                    {error}
                  </div>
                )}

                <FormButton className="w-full justify-center">
                  Log in
                </FormButton>
              </form>

              <div className="mt-6 space-y-3">
                <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Or continue with
                </p>
                <div className="flex flex-col gap-3">
                  <GoogleLoginButton
                    className="w-full"
                    onClick={() => {
                      window.location.href = `${API_BASE_URL}/api/auth/google-login`
                    }}
                  />
                  <GithubLoginButton
                    className="w-full"
                    onClick={() => {
                      window.location.href = `${API_BASE_URL}/api/auth/github-login`
                    }}
                    text="Login with GitHub"
                  />
                </div>
              </div>
            </div>
          </div>
        </MarketingShell>
      )}
    </>
  )
}

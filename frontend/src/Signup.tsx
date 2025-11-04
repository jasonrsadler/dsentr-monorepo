import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import PlugIcon from '@/assets/svg-components/PlugIcon'
import ClockIcon from '@/assets/svg-components/ClockIcon'
import ShieldIcon from '@/assets/svg-components/ShieldIcon'
import { WorkflowIllustration } from '@/assets/svg-components/WorkflowIllustration'
import { API_BASE_URL, parseInviteQuery, signupUser } from '@/lib'
import { FormButton } from './components/ui/buttons/FormButton'
import GoogleSignupButton from './components/GoogleSignupButton'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { MetaTags } from '@/components/MetaTags'
import { TermsOfServiceContent } from '@/components/legal/TermsOfServiceContent'
import {
  TERMS_OF_SERVICE_TITLE,
  TERMS_OF_SERVICE_VERSION
} from '@/constants/legal'
import GithubSignupButton from './components/GithubSignupButton'

const INVITE_ERROR_MESSAGE = 'Invalid or expired invite link'
const TERMS_ERROR_MESSAGE =
  'You must accept the Terms of Service to create an account.'

type InvitePreviewResponse = {
  success: boolean
  invitation: {
    id: string
    workspace_id: string
    workspace_name?: string
    email: string
    role: string
    token: string
    expires_at: string
    created_at: string
    accepted_at: string | null
    revoked_at: string | null
    declined_at: string | null
  }
  expired: boolean
  revoked: boolean
  accepted: boolean
  declined?: boolean
}

type SignupRequest = Parameters<typeof signupUser>[0]

type InviteStatus = 'none' | 'loading' | 'valid' | 'invalid'

function validateName(name: string) {
  return /^[a-zA-Z]{1,50}$/.test(name)
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function evaluatePasswordStrength(password: string): {
  label: string
  color: string
} {
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

function formatRole(role: string | null | undefined) {
  if (!role) return null
  const normalized = role.toLowerCase()
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export default function SignupPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirmPassword: '',
    company_name: '',
    country: '',
    tax_id: '',
    settings: {} as Record<string, any>
  })
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: boolean }>({})
  const [loading, setLoading] = useState(false)
  const [serverError, setServerError] = useState<boolean>(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsModalOpen, setTermsModalOpen] = useState(false)

  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('none')
  const [inviteDetails, setInviteDetails] =
    useState<InvitePreviewResponse | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteDecision, setInviteDecision] = useState<'join' | 'solo'>('join')

  const markTermsError = () => {
    setFieldErrors((prev) => {
      if (prev.termsAccepted) {
        return prev
      }
      return {
        ...prev,
        termsAccepted: true
      }
    })
    setErrors((prev) => {
      if (prev.includes(TERMS_ERROR_MESSAGE)) {
        return prev
      }
      return [TERMS_ERROR_MESSAGE, ...prev]
    })
  }

  const clearTermsError = () => {
    setFieldErrors((prev) => {
      if (!prev.termsAccepted) {
        return prev
      }
      const { termsAccepted: _ignored, ...rest } = prev
      return rest
    })
    setErrors((prev) => {
      const next = prev.filter((err) => err !== TERMS_ERROR_MESSAGE)
      return next.length === prev.length ? prev : next
    })
  }

  const ensureTermsAccepted = () => {
    if (termsAccepted) {
      clearTermsError()
      return true
    }
    markTermsError()
    return false
  }

  useEffect(() => {
    const result = parseInviteQuery(location.search)
    if (result.needsRedirect && result.canonicalSearch) {
      navigate(`/signup?${result.canonicalSearch}`, { replace: true })
      return
    }

    if (result.conflict) {
      setInviteToken(null)
      setInviteStatus('invalid')
      setInviteDetails(null)
      setInviteError(INVITE_ERROR_MESSAGE)
      setInviteDecision('join')
      setForm((prev) => ({ ...prev, email: '' }))
      return
    }

    if (result.token) {
      setInviteToken(result.token)
      setInviteStatus('loading')
      setInviteError(null)
    } else {
      setInviteToken(null)
      setInviteStatus('none')
      setInviteDetails(null)
      setInviteError(null)
      setInviteDecision('join')
      setForm((prev) => ({ ...prev, email: '' }))
    }
  }, [location.search, navigate])

  useEffect(() => {
    if (!inviteToken) {
      return
    }

    let cancelled = false
    const controller = new AbortController()

    const load = async () => {
      setInviteStatus('loading')
      setInviteError(null)
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/invites/${encodeURIComponent(inviteToken)}`,
          {
            signal: controller.signal
          }
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
          setInviteDetails(null)
          setInviteError(INVITE_ERROR_MESSAGE)
          return
        }

        setInviteDetails(data)
        setInviteStatus('valid')
        setInviteDecision('join')
        setForm((prev) => ({
          ...prev,
          email: data.invitation.email.toLowerCase()
        }))
      } catch (error: any) {
        if (cancelled || error?.name === 'AbortError') return
        setInviteStatus('invalid')
        setInviteDetails(null)
        setInviteError(INVITE_ERROR_MESSAGE)
      }
    }

    load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [inviteToken])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    if (inviteStatus === 'valid' && name === 'email') {
      return
    }
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationErrors: string[] = []
    const newFieldErrors: { [key: string]: boolean } = {}

    if (!validateName(form.first_name)) {
      validationErrors.push('Valid First Name is required (letters only).')
      newFieldErrors.first_name = true
    }
    if (!validateName(form.last_name)) {
      validationErrors.push('Valid Last Name is required (letters only).')
      newFieldErrors.last_name = true
    }
    if (!validateEmail(form.email)) {
      validationErrors.push('A valid Email is required.')
      newFieldErrors.email = true
    }
    if (!form.password.trim()) {
      validationErrors.push('Password is required.')
      newFieldErrors.password = true
    }
    if (!form.confirmPassword.trim()) {
      validationErrors.push('Verify Password is required.')
      newFieldErrors.confirmPassword = true
    }
    if (
      form.password &&
      form.confirmPassword &&
      form.password !== form.confirmPassword
    ) {
      validationErrors.push("Passwords don't match.")
      newFieldErrors.password = true
      newFieldErrors.confirmPassword = true
    }

    if (!termsAccepted) {
      validationErrors.push(TERMS_ERROR_MESSAGE)
      newFieldErrors.termsAccepted = true
    }

    setFieldErrors(newFieldErrors)

    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      setMessage(null)
      return
    }

    setErrors([])
    setFieldErrors({})
    setLoading(true)

    try {
      const { confirmPassword: _declined, ...rest } = form
      const baseRequest = rest as Omit<
        SignupRequest,
        'invite_token' | 'invite_decision'
      >
      const request = {
        ...baseRequest,
        invite_token:
          inviteStatus === 'valid' && inviteToken ? inviteToken : undefined,
        invite_decision:
          inviteStatus === 'valid' && inviteToken
            ? inviteDecision === 'join'
              ? 'join'
              : 'decline'
            : undefined,
        accepted_terms_version: TERMS_OF_SERVICE_VERSION
      } as SignupRequest

      const result = await signupUser(request)
      if (result.success) {
        navigate('/check-email')
      } else {
        setMessage(result.message)
        setServerError(true)
      }
    } catch (err: any) {
      setMessage(err.message)
      setServerError(true)
    } finally {
      setLoading(false)
    }
  }

  const handleOAuthSignup = (provider: 'google' | 'github') => {
    if (!ensureTermsAccepted()) {
      return
    }

    const targetUrl =
      provider === 'google'
        ? `${API_BASE_URL}/api/auth/google-login`
        : `${API_BASE_URL}/api/auth/github-login`

    window.location.href = targetUrl
  }

  const passwordStrength = evaluatePasswordStrength(form.password)
  const inviteRoleLabel = useMemo(
    () => formatRole(inviteDetails?.invitation?.role),
    [inviteDetails?.invitation?.role]
  )
  const submitLabel = useMemo(() => {
    if (inviteStatus === 'valid') {
      return inviteDecision === 'join' ? 'Join workspace' : 'Create account'
    }
    return 'Sign Up'
  }, [inviteDecision, inviteStatus])

  return (
    <>
      {termsModalOpen ? (
        <TermsOfServiceModal onClose={() => setTermsModalOpen(false)} />
      ) : null}
      <MetaTags
        title="Sign up - DSentr"
        description="Create a DSentr account to design and automate workflows without code."
      />
      <MarketingShell compact maxWidthClassName="max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,520px)] lg:items-start">
          <div className="hidden space-y-8 lg:flex lg:flex-col">
            <BrandHero
              title="Create your DSentr account"
              description="Build sophisticated automations, manage workspaces, and keep every run transparent."
              kicker="Get started"
              align="left"
            />

            <div className="overflow-hidden rounded-3xl border border-zinc-200/60 bg-white/70 p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900/70">
              <WorkflowIllustration />
            </div>

            <div className="grid gap-4 rounded-2xl border border-zinc-200/60 bg-white/70 p-6 text-left text-sm leading-relaxed text-zinc-600 shadow-sm dark:border-white/10 dark:bg-zinc-900/70 dark:text-zinc-300">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                Why teams choose DSentr
              </p>
              <FeatureBullet
                icon={<PlugIcon className="h-4 w-4" />}
                title="Composable modules"
                description="Snap together triggers, actions, and data transforms to create powerful logic."
              />
              <FeatureBullet
                icon={<ClockIcon className="h-4 w-4" />}
                title="Operational visibility"
                description="Observe every run with detailed logs, retry controls, and alerting."
              />
              <FeatureBullet
                icon={<ShieldIcon className="h-4 w-4" />}
                title="Workspace governance"
                description="Manage roles, credentials, and compliance with confidence."
              />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200/60 bg-white/80 p-8 shadow-lg shadow-indigo-500/5 dark:border-white/10 dark:bg-zinc-900/80">
            {inviteStatus === 'valid' && inviteDetails && (
              <div className="mb-6 rounded-xl border border-indigo-200/60 bg-indigo-50/80 p-4 text-sm text-indigo-900 shadow-sm dark:border-indigo-400/30 dark:bg-indigo-500/20 dark:text-indigo-100">
                <p className="font-semibold">
                  You&apos;re invited to join a workspace
                  {inviteRoleLabel ? ` as ${inviteRoleLabel}` : ''}.
                </p>
                <p className="mt-1 text-indigo-800/90 dark:text-indigo-100/80">
                  We&apos;ll use the invitation email{' '}
                  {inviteDetails.invitation.email} for your account.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setInviteDecision('join')}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      inviteDecision === 'join'
                        ? 'border-indigo-500 bg-indigo-500 text-white shadow'
                        : 'border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300 dark:border-indigo-500/40 dark:bg-transparent dark:text-indigo-100'
                    }`}
                  >
                    Join workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteDecision('solo')}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      inviteDecision === 'solo'
                        ? 'border-indigo-500 bg-indigo-500 text-white shadow'
                        : 'border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300 dark:border-indigo-500/40 dark:bg-transparent dark:text-indigo-100'
                    }`}
                  >
                    Create my own workspace
                  </button>
                </div>
              </div>
            )}

            {inviteStatus === 'loading' && (
              <p className="mb-4 rounded-lg border border-zinc-200/60 bg-zinc-100/80 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                Verifying invite link...
              </p>
            )}

            {inviteStatus === 'invalid' && inviteError && (
              <p className="mb-4 rounded-lg border border-amber-200/60 bg-amber-50/80 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                {inviteError}
              </p>
            )}

            {errors.length > 0 && (
              <div className="mb-4 rounded-2xl border border-red-200/60 bg-red-50/80 p-4 text-sm text-red-700 shadow-sm dark:border-red-400/30 dark:bg-red-950/20 dark:text-red-200">
                <h3 className="font-semibold">Please fix:</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-3">
              <GoogleSignupButton onClick={() => handleOAuthSignup('google')} />
              <GithubSignupButton onClick={() => handleOAuthSignup('github')} />
              <div className="relative text-center">
                <span className="relative z-10 bg-white/80 px-2 text-xs text-zinc-500 dark:bg-zinc-900/80 dark:text-zinc-400">
                  or
                </span>
                <div className="absolute left-0 top-1/2 h-px w-full bg-zinc-200 dark:bg-zinc-700" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {[
                  { name: 'first_name', label: 'First name', required: true },
                  { name: 'last_name', label: 'Last name', required: true },
                  { name: 'email', label: 'Work email', required: true },
                  { name: 'company_name', label: 'Company' },
                  {
                    name: 'password',
                    label: 'Password',
                    required: true,
                    type: 'password'
                  },
                  {
                    name: 'confirmPassword',
                    label: 'Verify password',
                    required: true,
                    type: 'password'
                  },
                  { name: 'country', label: 'Country' },
                  { name: 'tax_id', label: 'Tax ID' }
                ].map(({ name, label, required, type }) => {
                  const rawVal = (form as any)[name]
                  const value = typeof rawVal === 'string' ? rawVal : ''
                  const hasError = fieldErrors[name]
                  const isReadOnly =
                    inviteStatus === 'valid' && name === 'email'
                  return (
                    <div key={name} className="text-left">
                      <label
                        htmlFor={name}
                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
                      >
                        {label}
                        {required && (
                          <span
                            className="ml-1 text-red-500"
                            aria-hidden="true"
                          >
                            *
                          </span>
                        )}
                      </label>
                      <input
                        id={name}
                        type={type || 'text'}
                        name={name}
                        aria-label={label}
                        value={value}
                        onChange={handleChange}
                        readOnly={isReadOnly}
                        className={`mt-2 w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:text-zinc-100 ${
                          hasError
                            ? 'border-red-500/80 focus:ring-red-200'
                            : 'border-zinc-300/70 dark:border-zinc-600'
                        } ${isReadOnly ? 'cursor-not-allowed bg-zinc-100 dark:bg-zinc-800' : ''}`}
                      />
                      {name === 'password' && form.password && (
                        <div className="mt-2 space-y-1">
                          <div className="h-1 rounded bg-zinc-300 dark:bg-zinc-700">
                            <div
                              className={`h-1 rounded transition-all duration-300 ease-in-out ${
                                passwordStrength.label === 'Weak'
                                  ? 'bg-red-500 w-1/3'
                                  : passwordStrength.label === 'Moderate'
                                    ? 'bg-yellow-500 w-2/3'
                                    : 'bg-green-500 w-full'
                              }`}
                            />
                          </div>
                          <p className={`text-xs ${passwordStrength.color}`}>
                            Password strength: {passwordStrength.label}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div
                className={`rounded-2xl border p-4 text-sm transition ${
                  fieldErrors.termsAccepted
                    ? 'border-red-500/70 bg-red-50/70 dark:border-red-500/50 dark:bg-red-500/10'
                    : 'border-zinc-200/60 bg-white/70 dark:border-white/10 dark:bg-zinc-900/70'
                }`}
              >
                <label
                  className="flex items-start gap-3"
                  htmlFor="termsAccepted"
                >
                  <input
                    id="termsAccepted"
                    name="termsAccepted"
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setTermsAccepted(checked)
                      if (checked) {
                        clearTermsError()
                      }
                    }}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-600"
                    aria-describedby={
                      fieldErrors.termsAccepted
                        ? 'terms-acceptance-error'
                        : undefined
                    }
                  />
                  <span className="text-left text-zinc-600 dark:text-zinc-300">
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => setTermsModalOpen(true)}
                      className="font-medium text-indigo-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"
                    >
                      Terms of Service
                    </button>
                    .
                  </span>
                </label>
                {fieldErrors.termsAccepted ? (
                  <p
                    id="terms-acceptance-error"
                    className="mt-2 text-xs text-red-600 dark:text-red-300"
                  >
                    {TERMS_ERROR_MESSAGE}
                  </p>
                ) : null}
              </div>

              <FormButton disabled={loading} className="w-full justify-center">
                {loading ? 'Signing up...' : submitLabel}
              </FormButton>
              {message &&
                (serverError ? (
                  <p className="text-center text-sm text-red-600 dark:text-red-400">
                    {message}
                  </p>
                ) : (
                  <p className="text-center text-sm text-emerald-600 dark:text-emerald-400">
                    {message}
                  </p>
                ))}

              <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                No credit card required. Start for free, cancel anytime.
              </p>
            </form>
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

function TermsOfServiceModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-of-service-modal-title"
        className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-xl shadow-indigo-500/20 dark:border-white/10 dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-200/70 bg-white/80 px-6 py-4 dark:border-white/10 dark:bg-zinc-900/80">
          <h2
            id="terms-of-service-modal-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {TERMS_OF_SERVICE_TITLE}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-zinc-500 transition hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-zinc-400 dark:hover:text-zinc-200"
            aria-label="Close terms of service"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>
        <div className="themed-scroll max-h-[70vh] overflow-y-auto px-6 py-4 pr-8 text-sm text-zinc-700 dark:text-zinc-200">
          <TermsOfServiceContent />
        </div>
      </div>
    </div>
  )
}

function FeatureBullet({
  icon,
  title,
  description
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
        {icon}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          {description}
        </p>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import PlugIcon from '@/assets/svg-components/PlugIcon'
import ClockIcon from '@/assets/svg-components/ClockIcon'
import ShieldIcon from '@/assets/svg-components/ShieldIcon'
import { WorkflowIllustration } from '@/assets/svg-components/WorkflowIllustration'
import { API_BASE_URL, parseInviteQuery, signupUser } from '@/lib'
import { FormButton } from './components/UI/Buttons/FormButton'
import GoogleSignupButton from './components/GoogleSignupButton'
import GithubLoginButton from './components/GithubLoginButton'

const INVITE_ERROR_MESSAGE = 'Invalid or expired invite link'

type InvitePreviewResponse = {
  success: boolean
  invitation: {
    id: string
    workspace_id: string
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

  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('none')
  const [inviteDetails, setInviteDetails] =
    useState<InvitePreviewResponse | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteDecision, setInviteDecision] = useState<'join' | 'solo'>('join')

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
            : undefined
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
    <div className="relative flex flex-col items-start justify-center px-4 py-4 md:py-8 min-h-[calc(100vh-120px)] bg-white dark:bg-zinc-900 transition-colors">
      {errors.length > 0 && (
        <div className="hidden md:block w-80 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm rounded-lg p-4 h-fit float-right absolute top-30 right-10 mt-4 animate-fadeIn transition-opacity duration-300">
          <h3 className="font-semibold mb-2">Please fix:</h3>
          <ul className="list-disc list-inside space-y-1">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="max-w-5xl w-full flex flex-col md:flex-row gap-12">
        <div className="hidden md:flex w-1/2 flex-col items-center justify-start pt-4 pb-2">
          <WorkflowIllustration />
        </div>

        <div className="flex w-full md:w-1/2 gap-6">
          <div className="flex-1 bg-zinc-50 dark:bg-zinc-800 p-6 md:p-8 rounded-lg shadow-md transition-colors">
            <h2 className="text-2xl font-bold mb-1 text-center text-zinc-900 dark:text-zinc-100">
              Create your Dsentr account
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 text-center">
              Build automations with zero code.
            </p>

            {inviteStatus === 'valid' && inviteDetails && (
              <div className="mb-4 rounded-md border border-indigo-200 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10 p-4 text-sm text-indigo-900 dark:text-indigo-100">
                <p className="font-semibold">
                  You're invited to join a workspace
                  {inviteRoleLabel ? ` as ${inviteRoleLabel}` : ''}.
                </p>
                <p className="mt-1 text-indigo-800 dark:text-indigo-100/80">
                  We'll use the invitation email{' '}
                  {inviteDetails.invitation.email} for your account.
                </p>
                <div className="mt-3 flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={() => setInviteDecision('join')}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      inviteDecision === 'join'
                        ? 'border-indigo-500 bg-indigo-500 text-white'
                        : 'border-indigo-200 dark:border-indigo-500/40 bg-white dark:bg-transparent text-indigo-700 dark:text-indigo-100'
                    }`}
                  >
                    Join workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteDecision('solo')}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      inviteDecision === 'solo'
                        ? 'border-indigo-500 bg-indigo-500 text-white'
                        : 'border-indigo-200 dark:border-indigo-500/40 bg-white dark:bg-transparent text-indigo-700 dark:text-indigo-100'
                    }`}
                  >
                    Create my own workspace
                  </button>
                </div>
              </div>
            )}

            {inviteStatus === 'loading' && (
              <p className="mb-4 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200">
                Verifying invite link…
              </p>
            )}

            {inviteStatus === 'invalid' && inviteError && (
              <p className="mb-4 rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
                {inviteError}
              </p>
            )}

            <div className="flex flex-col gap-3">
              <GoogleSignupButton
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
              />
              <div className="relative text-center">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 px-2 z-10 relative">
                  or
                </span>
                <div className="absolute top-1/2 left-0 w-full h-px bg-zinc-200 dark:bg-zinc-700 z-0" />
              </div>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4 text-center">
                {[
                  { name: 'first_name', label: 'First Name', required: true },
                  { name: 'last_name', label: 'Last Name', required: true },
                  { name: 'email', label: 'Email', required: true },
                  { name: 'company_name', label: 'Company' },
                  {
                    name: 'password',
                    label: 'Password',
                    required: true,
                    type: 'password'
                  },
                  {
                    name: 'confirmPassword',
                    label: 'Verify Password',
                    required: true,
                    type: 'password'
                  },
                  { name: 'country', label: 'Country' },
                  { name: 'tax_id', label: 'Tax ID' }
                ].map(({ name, label, required, type }) => {
                  const value = (form as Record<string, string>)[name] ?? ''
                  return (
                    <div key={name}>
                      <label
                        htmlFor={name}
                        className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
                      >
                        {label}
                        {required && (
                          <span className="text-red-500 ml-1"> *</span>
                        )}
                      </label>
                      <input
                        id={name}
                        type={type || 'text'}
                        name={name}
                        value={value}
                        onChange={handleChange}
                        readOnly={inviteStatus === 'valid' && name === 'email'}
                        className={`w-full border ${
                          fieldErrors[name]
                            ? 'border-red-500 dark:border-red-500'
                            : 'border-zinc-300 dark:border-zinc-600'
                        } bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 mt-1 text-sm transition-colors ${
                          inviteStatus === 'valid' && name === 'email'
                            ? 'bg-zinc-100 dark:bg-zinc-800 cursor-not-allowed'
                            : ''
                        }`}
                      />
                      {name === 'password' && form.password && (
                        <div className="mt-2">
                          <div className="h-1 rounded bg-zinc-300 dark:bg-zinc-700 overflow-hidden">
                            <div
                              className={`h-1 transition-all duration-300 ease-in-out ${
                                passwordStrength.label === 'Weak'
                                  ? 'bg-red-500 w-1/3'
                                  : passwordStrength.label === 'Moderate'
                                    ? 'bg-yellow-500 w-2/3'
                                    : 'bg-green-500 w-full'
                              }`}
                            />
                          </div>
                          <p
                            className={`mt-1 text-xs ${passwordStrength.color}`}
                          >
                            Password Strength: {passwordStrength.label}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <FormButton
                disabled={loading}
                className={`${
                  loading
                    ? 'bg-indigo-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                {loading ? 'Signing up…' : submitLabel}
              </FormButton>
              {message &&
                (serverError ? (
                  <p className="mt-2 text-center text-red-600 dark:text-red-400">
                    {message}
                  </p>
                ) : (
                  <p className="mt-2 text-center text-green-600 dark:text-green-400">
                    {message}
                  </p>
                ))}

              <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center mt-4">
                No credit card required. Start for free, cancel anytime.
              </p>
            </form>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
              <div>
                <PlugIcon className="mx-auto mb-2 text-indigo-500" />
                Modular by Design
              </div>
              <div>
                <ClockIcon className="mx-auto mb-2 text-indigo-500" />
                Trigger-Driven Workflows
              </div>
              <div>
                <ShieldIcon className="mx-auto mb-2 text-indigo-500" />
                Secure & Scalable
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

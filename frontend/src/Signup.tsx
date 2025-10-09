import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PlugIcon from '@/assets/svg-components/PlugIcon'
import ClockIcon from '@/assets/svg-components/ClockIcon'
import ShieldIcon from '@/assets/svg-components/ShieldIcon'
import { WorkflowIllustration } from '@/assets/svg-components/WorkflowIllustration'
import { API_BASE_URL, signupUser } from '@/lib'
import { FormButton } from './components/UI/Buttons/FormButton'
import GoogleSignupButton from './components/GoogleSignupButton'
import GithubLoginButton from './components/GithubLoginButton'

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

export default function SignupPage() {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirmPassword: '',
    company_name: '',
    country: '',
    tax_id: '',
    settings: {}
  })
  const navigate = useNavigate()

  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: boolean }>({})
  const [loading, setLoading] = useState(false)
  const [serverError, setServerError] = useState<boolean>(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
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
      const result = await signupUser({ ...form })
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
                        value={(form as any)[name]}
                        onChange={handleChange}
                        className={`w-full border ${fieldErrors[name]
                            ? 'border-red-500 dark:border-red-500'
                            : 'border-zinc-300 dark:border-zinc-600'
                          } bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 mt-1 text-sm transition-colors`}
                      />
                      {name === 'password' && form.password && (
                        <div className="mt-2">
                          <div className="h-1 rounded bg-zinc-300 dark:bg-zinc-700 overflow-hidden">
                            <div
                              className={`h-1 transition-all duration-300 ease-in-out ${passwordStrength.label === 'Weak'
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
                className={`${loading
                    ? 'bg-indigo-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
              >
                {loading ? 'Signing up…' : 'Sign Up'}
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

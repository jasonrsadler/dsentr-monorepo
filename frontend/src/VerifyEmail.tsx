import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { verifyEmail } from '@/lib'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { MetaTags } from '@/components/MetaTags'

function useQuery() {
  return new URLSearchParams(useLocation().search)
}

export default function VerifyEmail() {
  const query = useQuery()
  const token = query.get('token')
  const navigate = useNavigate()

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>(
    'verifying'
  )
  const [message, setMessage] = useState<string>('Verifying your email...')

  const hasVerified = useRef(false)

  useEffect(() => {
    if (!token || hasVerified.current) return
    hasVerified.current = true

    const verify = async () => {
      try {
        const result = await verifyEmail(token)
        if (result.success) {
          setStatus('success')
          setMessage('Email verified! Redirecting...')
          setTimeout(() => navigate('/dashboard'), 3000)
        } else {
          setStatus('error')
          setMessage(result.message || 'Verification failed.')
        }
      } catch (err: any) {
        setStatus('error')
        setMessage(`Something went wrong during verification. ${err.message}`)
      }
    }

    verify()
  }, [token, navigate])

  return (
    <>
      <MetaTags
        title="Verify email – Dsentr"
        description="Confirm your Dsentr email address to activate your account."
      />
      <MarketingShell maxWidthClassName="max-w-3xl">
        <div className="space-y-10 text-center">
          <BrandHero
            title={
              status === 'success'
                ? 'Email verified'
                : status === 'error'
                  ? 'Verification failed'
                  : 'Verifying your email'
            }
            description={message}
            kicker="Account confirmation"
          />
          <span
            className={`mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 ${
              status === 'success'
                ? 'text-emerald-500'
                : status === 'error'
                  ? 'text-red-500'
                  : 'text-indigo-500'
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 5.25h16.5a1.5 1.5 0 011.5 1.5v10.5a1.5 1.5 0 01-1.5 1.5H3.75a1.5 1.5 0 01-1.5-1.5V6.75a1.5 1.5 0 011.5-1.5z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75l8.25 6 8.25-6"
              />
            </svg>
          </span>
        </div>
      </MarketingShell>
    </>
  )
}

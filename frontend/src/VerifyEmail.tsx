import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { verifyEmail } from '@/lib'

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
    <div className="min-h-[calc(100vh-120px)] flex items-center justify-center bg-white dark:bg-zinc-900 px-4">
      <div className="max-w-md w-full text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-20 h-20 mx-auto mb-6 ${
            status === 'success'
              ? 'text-green-500'
              : status === 'error'
                ? 'text-red-500'
                : 'text-indigo-500'
          }`}
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

        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
          {status === 'success'
            ? 'Email Verified'
            : status === 'error'
              ? 'Verification Failed'
              : 'Verifying...'}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm">{message}</p>
      </div>
    </div>
  )
}

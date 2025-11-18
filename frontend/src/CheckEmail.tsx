import EmailIcon from '@/assets/svg-components/EmailIcon'
import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { getCsrfToken } from './lib/csrfCache'
import { useState } from 'react'
import { API_BASE_URL } from './lib'

export default function CheckEmail() {
  const params = new URLSearchParams(window.location.search)
  const email = params.get('email') ?? ''
  async function resendVerification(email: string) {
    const csrf = await getCsrfToken()

    const res = await fetch(`${API_BASE_URL}/api/auth/resend-verification`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf
      },
      body: JSON.stringify({ email })
    })

    const data = await res.json()
    return data
  }

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleResend() {
    setLoading(true)
    try {
      const r = await resendVerification(email)
      setMessage(r.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <MetaTags
        title="Check your inbox - DSentr"
        description="We sent you a secure link to finish setting up your DSentr account."
      />
      <MarketingShell compact maxWidthClassName="max-w-3xl">
        <div className="space-y-12 text-center">
          <BrandHero
            title="Check your email"
            description="We've sent you a verification link. Open it on this device to continue."
            kicker="Next step"
          />

          <div className="flex flex-col items-center gap-6 rounded-2xl border border-zinc-200/60 bg-white/70 p-10 text-center shadow-sm dark:border-white/10 dark:bg-zinc-900/70">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <EmailIcon />
            </span>
            <p className="max-w-xl text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
              Didn&apos;t receive anything? Check your spam folder or request a
              new email. For security, the link expires in 15 minutes.
            </p>
            <button onClick={handleResend} disabled={loading}>
              {loading ? 'Sending...' : 'Resend verification email'}
            </button>
            {message && <div className="text-xs text-green-600">{message}</div>}
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

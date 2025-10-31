import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/stores/auth'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { MetaTags } from '@/components/MetaTags'

export default function LogoutHandler() {
  const navigate = useNavigate()
  const logout = useAuth((s) => s.logout)
  const hasLoggedOut = useRef(false)

  useEffect(() => {
    if (hasLoggedOut.current) return
    hasLoggedOut.current = true

    logout()
    navigate('/login', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <MetaTags
        title="Logging out - DSentr"
        description="Signing you out of DSentr."
      />
      <MarketingShell compact maxWidthClassName="max-w-3xl">
        <div className="space-y-10 text-center">
          <BrandHero
            title="Signing you out"
            description="We're closing your session and preparing a fresh start for next time."
            kicker="Security first"
          />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            If you are not redirected automatically,{' '}
            <a
              href="/login"
              className="font-medium text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400"
            >
              return to login
            </a>
            .
          </p>
        </div>
      </MarketingShell>
    </>
  )
}

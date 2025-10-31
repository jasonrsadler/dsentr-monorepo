import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const CONSENT_KEY = 'cookieConsent_v1' as const
const HIDE_ANIMATION_MS = 200

const isBrowser = () =>
  typeof window !== 'undefined' && typeof document !== 'undefined'

export default function CookieBanner() {
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const hideTimeoutRef = useRef<number>()

  useEffect(() => {
    if (!isBrowser()) {
      return
    }

    const storedConsent = window.localStorage.getItem(CONSENT_KEY)

    if (!storedConsent) {
      setShouldRender(true)

      const id = window.requestAnimationFrame(() => {
        setIsVisible(true)
      })

      return () => {
        window.cancelAnimationFrame(id)
      }
    }

    return undefined
  }, [])

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  if (!shouldRender) {
    return null
  }

  const handleAccept = () => {
    if (isBrowser()) {
      window.localStorage.setItem(CONSENT_KEY, 'true')
    }

    setIsVisible(false)

    hideTimeoutRef.current = window.setTimeout(() => {
      setShouldRender(false)
    }, HIDE_ANIMATION_MS)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-6 sm:pb-8">
      <div
        className={`pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-lg border border-zinc-200 bg-white/90 p-4 text-sm shadow-lg backdrop-blur transition-all duration-200 ease-out dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-100 sm:flex-row sm:items-center sm:justify-between ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
      >
        <p className="text-left text-zinc-800 dark:text-zinc-200">
          Dsentr uses cookies for essential site functionality and analytics. By
          using this site, you agree to our{' '}
          <Link
            to="/privacy"
            className="font-medium text-indigo-600 underline-offset-2 transition hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAccept}
            className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}

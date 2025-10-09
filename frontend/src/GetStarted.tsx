import { useState } from 'react'
import { joinWaitlist } from '@/lib/waitlistApi' // adjust path if needed
import { FormButton } from './components/UI/Buttons/FormButton'

export default function GetStarted() {
  const [submitted, setSubmitted] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await joinWaitlist(email)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-6 py-20 text-center">
      <h1 className="text-4xl font-bold mb-4 tracking-tight">
        Be First to Build Without Boundaries
      </h1>

      <p className="text-zinc-600 dark:text-zinc-400 mb-8 text-lg flex items-center justify-center gap-2">
        <SparkIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        Dsentr is your control center for automation - no scripts, no
        integrations, just powerful modular logic.
      </p>

      <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-lg p-6 shadow-md">
        {!submitted ? (
          <>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 flex items-center justify-center gap-1">
              <BellIcon className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
              Get early access + sneak peeks.
            </p>
            <form
              className="flex flex-col sm:flex-row gap-4 justify-center"
              onSubmit={handleSubmit}
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded dark:bg-zinc-800 dark:text-white"
              />
              <FormButton>Join Waitlist</FormButton>
            </form>
            {error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </>
        ) : (
          <p className="text-green-600 font-medium text-lg flex items-center justify-center gap-2">
            <CheckIcon className="w-5 h-5" />
            You're in! We'll be in touch soon.
          </p>
        )}
      </div>

      <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-6 flex items-center justify-center gap-1">
        <ShieldIcon className="w-4 h-4" />
        We'll never spam. Just occasional updates.
      </p>
    </main>
  )
}

// SVG Icon Components
function SparkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L13.5 9H21L14.5 14L16 22L12 17L8 22L9.5 14L3 9H10.5L12 2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2Zm6-6v-5a6 6 0 00-5-5.91V4a1 1 0 00-2 0v1.09A6 6 0 006 11v5l-2 2v1h16v-1l-2-2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-3Z"
        fill="currentColor"
      />
    </svg>
  )
}

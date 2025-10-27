import { useState, type ReactNode } from 'react'

import { joinWaitlist } from '@/lib/waitlistApi' // adjust path if needed
import { FormButton } from './components/ui/buttons/FormButton'
import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'

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
    <>
      <MetaTags
        title="Get started – Dsentr"
        description="Join the Dsentr waitlist to receive early access and launch updates."
      />
      <MarketingShell maxWidthClassName="max-w-4xl">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-start">
          <div className="space-y-10">
            <BrandHero
              title="Be first to build without boundaries"
              description="Join the waitlist for product updates, launch invites, and opportunities to help shape the future of Dsentr."
              kicker="Early access"
              align="left"
            />

            <div className="grid gap-6 rounded-2xl border border-zinc-200/60 bg-white/70 p-6 text-left shadow-sm dark:border-white/10 dark:bg-zinc-900/70">
              <FeatureRow
                icon={<SparkIcon className="h-5 w-5" />}
                title="Modular automation without the overhead"
                description="Design workflows visually, connect data sources in minutes, and deploy them confidently."
              />
              <FeatureRow
                icon={<BellIcon className="h-5 w-5" />}
                title="Priority product updates"
                description="Be the first to hear about new modules, integration launches, and roadmap milestones."
              />
              <FeatureRow
                icon={<ShieldIcon className="h-5 w-5" />}
                title="Privacy-first communication"
                description="We only send high-signal updates. No spam, just actionable insights from the team."
              />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200/60 bg-white/80 p-8 shadow-lg shadow-indigo-500/5 dark:border-white/10 dark:bg-zinc-900/80">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2 text-left">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Work email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-zinc-300/70 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>

                {error && (
                  <p className="rounded-lg border border-red-200/60 bg-red-50/80 px-3 py-2 text-sm text-red-600 dark:border-red-400/30 dark:bg-red-950/20 dark:text-red-200">
                    {error}
                  </p>
                )}

                <FormButton className="w-full justify-center">
                  Join waitlist
                </FormButton>
              </form>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center text-emerald-600 dark:text-emerald-300">
                <CheckIcon className="h-6 w-6" />
                <p className="text-base font-medium">
                  You&apos;re in! We&apos;ll be in touch soon.
                </p>
              </div>
            )}

            <p className="mt-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              By joining the waitlist you agree to receive occasional emails
              about Dsentr. You can unsubscribe at any time.
            </p>
          </div>
        </div>
      </MarketingShell>
    </>
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

function FeatureRow({
  icon,
  title,
  description
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-4">
      <span className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
        {icon}
      </span>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          {description}
        </p>
      </div>
    </div>
  )
}

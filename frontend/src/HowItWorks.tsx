import { NavigateButton } from './components/ui/buttons/NavigateButton'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { MetaTags } from '@/components/MetaTags'

const steps = [
  {
    title: 'Modular plugin system',
    description:
      'Powered by a dynamic plugin architecture that keeps complexity manageable as you scale.',
    icon: (
      <svg
        className="h-10 w-10 text-indigo-600 dark:text-indigo-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <path d="M5 3h3a1 1 0 011 1v1a2 2 0 104 0V4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-3a1 1 0 011-1h1a2 2 0 100-4H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
      </svg>
    )
  },
  {
    title: 'Workflow builder',
    description:
      'Build powerful automations by chaining plugins together in a visual canvas.',
    icon: (
      <svg
        className="h-10 w-10 text-indigo-600 dark:text-indigo-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <path d="M6 3h12M6 3v6m12-6v6M6 9h12M9 9v6m6-6v6M9 15H6m9 0h3M12 15v6" />
      </svg>
    )
  },
  {
    title: 'Execution engine',
    description:
      'Our engine runs workflows step-by-step, with reliable retries and clear state at every stage.',
    icon: (
      <svg
        className="h-10 w-10 text-indigo-600 dark:text-indigo-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <path d="M13 3L4 14h7v7l9-11h-7z" />
      </svg>
    )
  },
  {
    title: 'Web UI',
    description:
      'Our clean interface makes it easy to build, test, and manage workflows.',
    icon: (
      <svg
        className="h-10 w-10 text-indigo-600 dark:text-indigo-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
      >
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    )
  }
]

export default function HowItWorks() {
  return (
    <>
      <MetaTags
        title="How DSentr works"
        description="Understand the DSentr workflow engine from modular plugins to visual orchestration."
      />
      <MarketingShell compact>
        <div className="space-y-16">
          <BrandHero
            title="How DSentr works"
            description="A modular platform that brings structure to automation. Here's how each layer comes together to power your workflows."
            kicker="Platform overview"
          />

          <div className="grid gap-10 md:grid-cols-2">
            {steps.map((step) => (
              <article
                key={step.title}
                className="group h-full rounded-2xl border border-zinc-200/60 bg-white/70 p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-white/10 dark:bg-zinc-900/70"
              >
                <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-indigo-500/10 p-3 text-indigo-600 transition group-hover:bg-indigo-500/15 dark:text-indigo-400">
                  {step.icon}
                </div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  {step.title}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {step.description}
                </p>
              </article>
            ))}
          </div>

          <div className="flex flex-col items-center gap-4 rounded-2xl border border-indigo-200/40 bg-indigo-500/5 p-8 text-center shadow-inner dark:border-indigo-400/30 dark:bg-indigo-500/10">
            <p className="max-w-2xl text-base text-zinc-700 dark:text-zinc-200">
              Ready to orchestrate your next workflow? Join the waitlist to
              access DSentr as soon as it opens to early teams.
            </p>
            <NavigateButton to="/signup" className="px-6 py-3 text-base">
              Try Now
            </NavigateButton>
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

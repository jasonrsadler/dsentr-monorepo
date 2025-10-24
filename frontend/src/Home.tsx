import type { ReactNode } from 'react'

import PlugIcon from '@/assets/svg-components/PlugIcon'
import ClockIcon from '@/assets/svg-components/ClockIcon'
import ShieldIcon from '@/assets/svg-components/ShieldIcon'
import ModularAnimation from '@/components/ModularAnimation'
import { usePageMeta } from '@/hooks/usePageMeta'
import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { NavigateButton } from './components/UI/Buttons/NavigateButton'

export default function Home() {
  usePageMeta({
    title: 'Dsentr - Visual Automation for Everyone',
    description: 'Build and run powerful no-code workflows with Dsentr',
    url: 'https://dsentr.com/',
    image: 'https://dsentr.com/og-dsentr.svg' // Add a real image path here
  })
  return (
    <>
      <MetaTags
        title="Dsentr - Visual Automation for Everyone"
        description="Build and run powerful no-code workflows with Dsentr"
      />
      <MarketingShell panelClassName="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 opacity-60">
          <ModularAnimation />
        </div>

        <div className="relative space-y-16">
          <BrandHero
            title="Visual automation for ambitious teams"
            description="Build, launch, and scale sophisticated workflows without the spreadsheet hacks. Dsentr turns automation into a canvas you can trust."
            kicker="Launch faster"
            actions={
              <NavigateButton to="/get-started" className="px-6 py-3 text-base">
                Start building
              </NavigateButton>
            }
          />

          <section className="grid gap-8 md:grid-cols-3">
            <FeatureCard
              icon={<PlugIcon />}
              title="Composable building blocks"
              description="Assemble logic from reusable modules that connect with your existing stack. No fragile scripts, just components that snap together."
            />
            <FeatureCard
              icon={<ClockIcon />}
              title="Event-ready orchestration"
              description="Orchestrate workflows that respond instantly to triggers, schedules, and data changes without manual intervention."
            />
            <FeatureCard
              icon={<ShieldIcon />}
              title="Enterprise-grade guardrails"
              description="Security, observability, and governance are built in so your automations scale safely across teams and environments."
            />
          </section>
        </div>
      </MarketingShell>
    </>
  )
}

interface FeatureCardProps {
  icon: ReactNode
  title: string
  description: string
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <article className="group relative h-full rounded-2xl border border-zinc-200/60 bg-white/70 p-6 text-left shadow-sm transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-white/10 dark:bg-zinc-900/70">
      <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-indigo-500/10 p-3 text-indigo-600 transition group-hover:bg-indigo-500/15 dark:text-indigo-400">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        {description}
      </p>
    </article>
  )
}

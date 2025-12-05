import { useState } from 'react'
import { Check, Info, Minus, Plus } from 'lucide-react'

import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'
import { NavigateButton } from '@/components/ui/buttons/NavigateButton'

type FeatureStatus = 'included' | 'excluded' | 'note'

interface PlanFeature {
  label: string
  status: FeatureStatus
}

interface PlanCardProps {
  name: string
  subtitle: string
  price: string
  priceSuffix: string
  caption?: string
  ctaLabel: string
  features: PlanFeature[]
  highlight?: string
}

interface FaqItem {
  question: string
  answer: string
}

const soloFeatures: PlanFeature[] = [
  { label: '250 workflow runs per month', status: 'included' },
  { label: 'Single user only', status: 'included' },
  { label: 'Up to three workflows', status: 'included' },
  { label: 'No schedule triggers', status: 'excluded' },
  { label: 'No team members', status: 'excluded' },
  { label: 'No overage billing', status: 'note' },
  { label: 'Fair-use limits apply', status: 'note' }
]

const workspaceFeatures: PlanFeature[] = [
  { label: '20,000 workflow runs per month included', status: 'included' },
  {
    label:
      'Additional runs billed as overage ($0.003 per run over)',
    status: 'note'
  },
  {
    label: 'Up to 8 members',
    status: 'included'
  },
  { label: 'Unlimited workflows', status: 'included' },
  { label: 'Access to all triggers and actions', status: 'included' },
  { label: 'OAuth workspace connections', status: 'included' },
  { label: 'Usage dashboard', status: 'included' }
]

const faqs: FaqItem[] = [
  {
    question: 'What happens if I exceed my monthly run limit?',
    answer:
      'Workspace plans allow metered overage billing ($0.003 per run over). Runs continue uninterrupted and are billed at the configured rate until the limit resets at the end of the billing cycle. Free Solo plans simply stop running until the next monthly reset.'
  },
  {
    question: 'Can I invite my team?',
    answer: 'Yes, on the Workspace plan. Solo plans are single-user only.'
  },
  {
    question: 'Does Dsentr store my OAuth credentials?',
    answer:
      'OAuth tokens are encrypted at rest using workspace-scoped keys. Rotation and revocation are fully supported.'
  },
  {
    question: 'Is there a self-hosted version?',
    answer:
      'Not at launch. If one becomes available later, it will be listed on the pricing page.'
  },
  {
    question: 'Do you offer refunds?',
    answer:
      'Refunds follow the policy shown in the Billing and Payments section of the Terms of Service.'
  },
  {
    question: "Can workflows run while I'm offline?",
    answer:
      'Yes. Triggers, executions, and delays all run on the backend. The app does not need to be open.'
  }
]

export default function Pricing() {
  return (
    <>
      <MetaTags
        title="Pricing - DSentr"
        description="Choose between the free Solo plan or the paid Workspace plan with included runs, overage billing, and team access."
      />
      <MarketingShell compact maxWidthClassName="max-w-6xl">
        <div className="space-y-12">
          <BrandHero
            title="DSentr pricing"
            description="Solo is free with 250 workflow runs and up to three workflows. Workspace starts at $29 per month, includes 20,000 runs, overage billing, up to 8 members, unlimited workflows, all triggers and actions, OAuth connections, and usage dashboard."
            kicker="Pricing"
            actions={
              <NavigateButton to="/signup" className="px-6 py-3 text-base">
                Get Started
              </NavigateButton>
            }
            align="left"
          />

          <section className="grid gap-6 md:grid-cols-2">
            <PlanCard
              name="Solo"
              subtitle="Free"
              price="$0"
              priceSuffix="per month"
              caption="Start for free and upgrade in the app"
              ctaLabel="Get Started"
              features={soloFeatures}
            />
            <PlanCard
              name="Workspace"
              subtitle="Paid"
              price="$29"
              priceSuffix="per month"
              caption="Automatically renews each month"
              ctaLabel="Get Started"
              features={workspaceFeatures}
              highlight="Most popular"
            />
          </section>

          <div className="rounded-xl border border-indigo-200/60 bg-indigo-500/5 px-4 py-3 text-center text-sm font-medium text-indigo-700 shadow-sm dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-indigo-200">
            All plans include secure execution and encrypted secrets.
          </div>

          <section className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                Frequently asked questions
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Answers about run limits, team access, billing, and platform
                availability.
              </p>
            </div>
            <Accordion items={faqs} />
          </section>
        </div>
      </MarketingShell>
    </>
  )
}

function PlanCard({
  name,
  subtitle,
  price,
  priceSuffix,
  caption,
  ctaLabel,
  features,
  highlight
}: PlanCardProps) {
  const highlightStyles = highlight
    ? 'border-indigo-200/70 shadow-indigo-500/15 dark:border-indigo-400/40'
    : ''

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border border-zinc-200/70 bg-white/80 p-8 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-white/10 dark:bg-zinc-900/80 ${highlightStyles}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-500">
            {subtitle}
          </p>
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            {name}
          </h2>
        </div>
        {highlight ? (
          <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
            {highlight}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
          {price}
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-300">
          {priceSuffix}
        </span>
      </div>
      {caption ? (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          {caption}
        </p>
      ) : null}

      <div className="mt-6">
        <NavigateButton
          to="/signup"
          className="w-full justify-center text-sm font-semibold"
        >
          {ctaLabel}
        </NavigateButton>
      </div>

      <div className="mt-8 space-y-3">
        {features.map((feature) => (
          <FeatureRow
            key={feature.label}
            label={feature.label}
            status={feature.status}
          />
        ))}
      </div>
    </article>
  )
}

function FeatureRow({ label, status }: PlanFeature) {
  const icon =
    status === 'included' ? (
      <Check className="h-4 w-4" />
    ) : status === 'excluded' ? (
      <Minus className="h-4 w-4" />
    ) : (
      <Info className="h-4 w-4" />
    )

  const iconStyles =
    status === 'included'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'excluded'
        ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300'
        : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'

  return (
    <div className="flex items-start gap-3 rounded-xl border border-transparent px-2 py-1 transition hover:border-indigo-100 hover:bg-indigo-50/40 dark:hover:border-indigo-900/40 dark:hover:bg-indigo-900/10">
      <span
        className={`mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full ${iconStyles}`}
      >
        {icon}
      </span>
      <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
        {label}
      </p>
    </div>
  )
}

function Accordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/80 shadow-sm dark:divide-zinc-800 dark:border-white/10 dark:bg-zinc-900/80">
      {items.map((item, index) => {
        const isOpen = openIndex === index
        return (
          <div key={item.question} className="p-4 sm:p-5">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 text-left"
              aria-expanded={isOpen}
              onClick={() => setOpenIndex(isOpen ? null : index)}
            >
              <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {item.question}
              </span>
              <span className="rounded-full bg-indigo-500/10 p-2 text-indigo-600 transition dark:bg-indigo-500/20 dark:text-indigo-300">
                {isOpen ? (
                  <Minus className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </span>
            </button>
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${isOpen
                ? 'grid-rows-[1fr] opacity-100'
                : 'grid-rows-[0fr] opacity-0'
                }`}
            >
              <div className="overflow-hidden">
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {item.answer}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

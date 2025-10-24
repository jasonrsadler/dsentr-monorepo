import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'

const highlights = [
  {
    title: 'Our mission',
    description:
      'Empower builders with the freedom to automate without friction. Dsentr translates complex systems into modular, reliable building blocks anyone can orchestrate.'
  },
  {
    title: 'Our vision',
    description:
      'Software should feel composable and transparent. We imagine a future where teams assemble workflows the way designers compose layouts – visually, collaboratively, and with complete control.'
  },
  {
    title: 'Our principles',
    description:
      'Clarity, composability, and trust. Every interaction in Dsentr is crafted to stay out of your way while giving you the levers to scale securely and sustainably.'
  }
]

export default function About() {
  return (
    <>
      <MetaTags
        title="About – Dsentr"
        description="Meet the team behind Dsentr and learn about our mission to simplify automation."
      />
      <MarketingShell>
        <div className="space-y-16">
          <BrandHero
            title="People-first automation"
            description="We are designers, engineers, and operators who believe automation should accelerate human creativity. Dsentr turns sophisticated workflows into approachable, dependable systems."
            kicker="Our story"
          />

          <section className="grid gap-8 md:grid-cols-3">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-zinc-200/60 bg-white/70 p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-white/10 dark:bg-zinc-900/70"
              >
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  {item.title}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {item.description}
                </p>
              </div>
            ))}
          </section>

          <section className="grid gap-10 rounded-2xl border border-zinc-200/60 bg-gradient-to-br from-indigo-500/10 via-white/60 to-purple-500/10 p-10 text-left shadow-inner dark:border-white/10 dark:from-indigo-400/10 dark:via-zinc-900/60 dark:to-purple-400/10">
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                Why we built Dsentr
              </h2>
              <p className="text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
                Dsentr started as a response to brittle, opaque automation
                stacks. We wanted a platform that made complex orchestration
                approachable without hiding the details that matter. Triggers,
                actions, and data flow are all modular so teams can move quickly
                without losing governance.
              </p>
            </div>
            <p className="text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
              Today, we partner with teams of all sizes to streamline
              operations, prototype ideas faster, and ship dependable workflows.
              If you are building the future of your business on automation,
              Dsentr is built to grow with you.
            </p>
          </section>
        </div>
      </MarketingShell>
    </>
  )
}

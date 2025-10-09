import { MetaTags } from '@/components/MetaTags'

// src/pages/About.tsx
export default function About() {
  return (
    <>
      <MetaTags
        title="About – Dsentr"
        description="Meet the team behind Dsentr and learn about our mission to simplify automation."
      />
      <div className="min-h-screen px-6 py-20 text-center text-zinc-900 dark:text-zinc-100">
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-8">
          About{' '}
          <span className="text-indigo-600 dark:text-indigo-400">Dsentr</span>
        </h1>

        <p className="max-w-3xl mx-auto text-lg text-zinc-700 dark:text-zinc-300">
          Dsentr is a modern, modular no-code automation platform built for
          developers, makers, and businesses that want power without complexity.
          We believe automation should be accessible, composable, and scalable -
          without sacrificing control.
        </p>

        <section className="mt-16 grid md:grid-cols-3 gap-10 max-w-6xl mx-auto text-left">
          <div>
            <h2 className="text-2xl font-semibold mb-4">Our Mission</h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              To empower creators and teams by eliminating the friction between
              ideas and execution. We enable anyone to build complex automations
              without writing code, while still offering power and precision
              when needed.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold mb-4">Our Vision</h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              We imagine a future where software is built from blocks -
              reusable, remixable, and transparent. Dsentr is our step toward
              that future: a tool that balances simplicity with depth.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold mb-4">Our Principles</h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              Dsentr is built around clarity, composability, and trust. We
              believe great tools should be invisible when you're in flow -
              reliable, fast, and tailored to the way you think. Every design
              decision reflects our focus on user empowerment and long-term
              maintainability.
            </p>
          </div>
        </section>

        <section className="mt-20 max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold mb-4">
            The Story Behind Dsentr
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Dsentr began as a personal frustration with rigid workflow tools and
            opaque automation systems. Instead of yet another drag-and-drop
            builder or bloated interface, we wanted a focused platform with a
            clean mental model: triggers, actions, and data flow - all modular,
            pluggable, and easy to evolve.
          </p>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            Whether you're a solo maker or an engineering team, Dsentr is
            designed to give you the building blocks to move fast and automate
            confidently.
          </p>
        </section>
      </div>
    </>
  )
}

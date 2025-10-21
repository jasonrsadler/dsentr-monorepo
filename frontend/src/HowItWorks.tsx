// src/pages/HowItWorks.tsx
import { NavigateButton } from './components/ui/buttons/NavigateButton'

export default function HowItWorks() {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-grow px-6 py-20 max-w-5xl mx-auto">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-center mb-12">
          How Dsentr Works
        </h1>

        <div className="grid md:grid-cols-2 gap-12 mb-20">
          <div className="flex flex-col items-start">
            <div className="mb-4">
              {/* Puzzle icon */}
              <svg
                className="w-10 h-10 text-indigo-600 dark:text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M5 3h3a1 1 0 011 1v1a2 2 0 104 0V4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-3a1 1 0 011-1h1a2 2 0 100-4H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-2">
              Modular Plugin System
            </h2>
            <p className="text-zinc-700 dark:text-zinc-300">
              Dsentr is powered by a dynamic plugin architecture. Each plugin is
              a self-contained module with defined inputs, outputs, and
              capabilities. These plugins can be triggers, actions, or data
              processors.
            </p>
          </div>

          <div className="flex flex-col items-start">
            <div className="mb-4">
              {/* Flowchart icon */}
              <svg
                className="w-10 h-10 text-indigo-600 dark:text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M6 3h12M6 3v6m12-6v6M6 9h12M9 9v6m6-6v6M9 15H6m9 0h3M12 15v6" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-2">Workflow Builder</h2>
            <p className="text-zinc-700 dark:text-zinc-300">
              Build powerful automations by chaining plugins together. Our
              visual builder lets you define inputs, outputs, and parameters,
              creating a logical flow that runs exactly how you need.
            </p>
          </div>

          <div className="flex flex-col items-start">
            <div className="mb-4">
              {/* Lightning bolt icon */}
              <svg
                className="w-10 h-10 text-indigo-600 dark:text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M13 3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-2">Execution Engine</h2>
            <p className="text-zinc-700 dark:text-zinc-300">
              Whether triggered manually, on schedule, or by external events,
              our engine runs workflows step-by-step or in parallel - managing
              state, errors, and dependencies automatically.
            </p>
          </div>

          <div className="flex flex-col items-start">
            <div className="mb-4">
              {/* Layout icon */}
              <svg
                className="w-10 h-10 text-indigo-600 dark:text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-2">Web UI</h2>
            <p className="text-zinc-700 dark:text-zinc-300">
              Our clean interface makes it easy to build, manage, and monitor
              workflows. From configuring modules to inspecting run history -
              you stay in control with zero code.
            </p>
          </div>
        </div>

        <div className="text-center mt-10">
          <NavigateButton to="/get-started">Try Now</NavigateButton>
        </div>
      </main>
    </div>
  )
}

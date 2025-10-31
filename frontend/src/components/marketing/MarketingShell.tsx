import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface MarketingShellProps {
  children: ReactNode
  maxWidthClassName?: string
  panelClassName?: string
}

export function MarketingShell({
  children,
  maxWidthClassName = 'max-w-5xl',
  panelClassName
}: MarketingShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-zinc-50 via-white to-zinc-100 dark:from-zinc-950 dark:via-zinc-950 dark:to-black">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-15%] h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute right-[-10%] top-1/2 h-[420px] w-[420px] -translate-y-1/2 rounded-full bg-purple-500/15 blur-[160px]" />
        <div className="absolute left-[-12%] bottom-[-18%] h-[360px] w-[360px] rounded-full bg-sky-500/10 blur-[140px]" />
      </div>
      <div
        className={`relative z-10 mx-auto w-full ${maxWidthClassName} px-6 py-20 sm:py-24 lg:py-28`}
      >
        <div
          className={`rounded-3xl border border-white/60 bg-white/80 p-10 shadow-2xl shadow-indigo-500/10 backdrop-blur-2xl transition-colors dark:border-white/10 dark:bg-zinc-900/80 sm:p-12 ${panelClassName ?? ''}`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

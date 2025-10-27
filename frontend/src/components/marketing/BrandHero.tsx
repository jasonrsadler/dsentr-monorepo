import type { ReactNode } from 'react'

import { DsentrLogo } from '@/components/DsentrLogo'

interface BrandHeroProps {
  title: string
  description?: string
  kicker?: string
  align?: 'center' | 'left'
  actions?: ReactNode
}

export function BrandHero({
  title,
  description,
  kicker,
  align = 'center',
  actions
}: BrandHeroProps) {
  const alignment =
    align === 'center' ? 'items-center text-center' : 'items-start text-left'
  const brandAlignment = align === 'center' ? 'justify-center' : ''
  const actionAlignment =
    align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <div className={`flex flex-col gap-6 ${alignment}`}>
      <div
        className={`flex items-center gap-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 ${brandAlignment}`}
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <DsentrLogo className="h-7 w-7" />
        </span>
      </div>
      {kicker ? (
        <span className="text-xs font-semibold uppercase tracking-[0.4em] text-indigo-500">
          {kicker}
        </span>
      ) : null}
      <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-5xl md:text-6xl">
        {title}
      </h1>
      {description ? (
        <p className="max-w-3xl text-lg text-zinc-600 dark:text-zinc-300">
          {description}
        </p>
      ) : null}
      {actions ? (
        <div className={`flex flex-wrap gap-3 ${actionAlignment}`}>
          {actions}
        </div>
      ) : null}
    </div>
  )
}

import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import type { ReactNode } from 'react'

type Variant = 'info' | 'warning' | 'danger'

const VARIANT_STYLES: Record<
  Variant,
  { border: string; background: string; text: string; icon: typeof Info }
> = {
  info: {
    border: 'border-blue-200 dark:border-blue-900',
    background: 'bg-blue-50 dark:bg-blue-900/30',
    text: 'text-blue-900 dark:text-blue-100',
    icon: Info
  },
  warning: {
    border: 'border-amber-200 dark:border-amber-900',
    background: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-900 dark:text-amber-100',
    icon: AlertTriangle
  },
  danger: {
    border: 'border-red-200 dark:border-red-900',
    background: 'bg-red-50 dark:bg-red-900/30',
    text: 'text-red-900 dark:text-red-100',
    icon: OctagonAlert
  }
}

export interface QuotaBannerProps {
  variant?: Variant
  title: string
  description?: ReactNode
  actionLabel?: string
  onAction?: () => void
  actionDisabled?: boolean
}

export function QuotaBanner({
  variant = 'info',
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled
}: QuotaBannerProps) {
  const styles = VARIANT_STYLES[variant]
  const Icon = styles.icon
  return (
    <div
      className={`flex items-start gap-3 rounded-md border px-3 py-2 ${styles.border} ${styles.background}`}
      data-testid="quota-banner"
    >
      <Icon className={`h-5 w-5 flex-shrink-0 ${styles.text}`} />
      <div className="flex-1">
        <p className={`text-sm font-semibold ${styles.text}`}>{title}</p>
        {description ? (
          <div className="text-sm text-zinc-700 dark:text-zinc-200">
            {description}
          </div>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="rounded border border-current px-3 py-1 text-xs font-medium uppercase tracking-wide disabled:opacity-50"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

export default QuotaBanner

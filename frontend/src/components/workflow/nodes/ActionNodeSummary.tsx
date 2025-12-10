interface ActionNodeSummaryProps {
  planRestrictionMessage?: string | null
  onPlanUpgrade?: () => void
  hint?: string
}

export default function ActionNodeSummary({
  planRestrictionMessage,
  onPlanUpgrade,
  hint = 'Configure this action in the flyout.'
}: ActionNodeSummaryProps) {
  return (
    <div className="mt-2 space-y-2 text-xs text-zinc-600 dark:text-zinc-300">
      {planRestrictionMessage ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex items-start justify-between gap-2">
            <span>{planRestrictionMessage}</span>
            {onPlanUpgrade ? (
              <button
                type="button"
                onClick={onPlanUpgrade}
                className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-400/10"
              >
                Upgrade
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-dashed border-zinc-200 bg-white/60 px-3 py-2 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">
        <p>{hint}</p>
      </div>
    </div>
  )
}

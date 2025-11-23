import { useEffect, useMemo } from 'react'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { normalizePlanTier } from '@/lib/planTiers'
import { usePlanUsageStore } from '@/stores/planUsageStore'
import { WORKSPACE_RUN_LIMIT_FALLBACK } from '@/lib/usageDefaults'

type MemberUsageDisplay = {
  userId: string
  primary: string
  secondary?: string
  runs: number
}

const formatMemberUsage = (entry: {
  user_id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  runs: number
}): MemberUsageDisplay => {
  const first = entry.first_name?.trim() ?? ''
  const last = entry.last_name?.trim() ?? ''
  const fullName = [first, last].filter(Boolean).join(' ')
  const email = entry.email?.trim() ?? ''
  const primary = fullName || email || entry.user_id
  const secondary = fullName && email ? email : undefined
  return { userId: entry.user_id, primary, secondary, runs: entry.runs }
}

export default function UsageTab() {
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const planUsage = usePlanUsageStore((state) => state.usage)
  const refreshPlanUsage = usePlanUsageStore((state) => state.refresh)

  const planTier = useMemo(
    () => normalizePlanTier(currentWorkspace?.workspace.plan ?? undefined),
    [currentWorkspace?.workspace.plan]
  )

  useEffect(() => {
    if (!currentWorkspace?.workspace.id) return
    if (planTier !== 'workspace') return
    void refreshPlanUsage(currentWorkspace.workspace.id)
  }, [currentWorkspace?.workspace.id, planTier, refreshPlanUsage])

  if (planTier !== 'workspace') {
    return (
      <div className="text-sm text-zinc-600 dark:text-zinc-300">
        Usage is available when this workspace is on the Workspace plan.
      </div>
    )
  }

  const runsUsage = planUsage?.workspace?.runs
  const memberUsage = planUsage?.workspace?.member_usage ?? []
  const limit =
    runsUsage?.limit && runsUsage.limit > 0
      ? runsUsage.limit
      : WORKSPACE_RUN_LIMIT_FALLBACK
  const used = runsUsage?.used ?? 0
  const overage =
    typeof runsUsage?.overage === 'number'
      ? runsUsage.overage
      : Math.max(0, used - limit)
  const percent =
    limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : null
  const tone =
    percent !== null && percent >= 100
      ? 'danger'
      : percent !== null && percent >= 90
        ? 'warning'
        : 'neutral'
  const barClass =
    tone === 'danger'
      ? 'bg-red-500'
      : tone === 'warning'
        ? 'bg-amber-400'
        : 'bg-indigo-500'
  const textClass =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-zinc-800 dark:text-zinc-100'

  const memberUsageRows = memberUsage
    .map((entry) => formatMemberUsage(entry))
    .sort((a, b) => b.runs - a.runs)

  return (
    <div className="space-y-4">
      <div className="rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Workspace run usage
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Resets each billing period
            </div>
          </div>
          <div className={`text-sm font-semibold ${textClass}`}>
            {used.toLocaleString()} / {limit.toLocaleString()} runs
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${barClass}`}
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
          {overage > 0
            ? `${overage.toLocaleString()} runs are over the monthly limit and will be billed as overage.`
            : 'Additional runs will be billed as overage once you cross the monthly limit.'}
        </div>
      </div>

      <div className="rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Usage by member
          </div>
          {runsUsage?.period_start ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Since {new Date(runsUsage.period_start).toLocaleDateString()}
            </div>
          ) : null}
        </div>
        {memberUsageRows.length === 0 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-300">
            No workflow runs have been recorded for this workspace yet.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {memberUsageRows.map((entry) => (
              <div
                key={entry.userId}
                className="flex items-center justify-between py-2"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {entry.primary}
                  </span>
                  {entry.secondary ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {entry.secondary}
                    </span>
                  ) : null}
                </div>
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {entry.runs.toLocaleString()} runs
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

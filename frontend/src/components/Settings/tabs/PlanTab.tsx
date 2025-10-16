import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { API_BASE_URL } from '@/lib'
import { normalizePlanTier, type PlanTier } from '@/lib/planTiers'
import { getCsrfToken } from '@/lib/csrfCache'
import { useAuth } from '@/stores/auth'

type PlanOption = {
  tier: PlanTier
  name: string
  description: string
  price: string
}

const FALLBACK_PLAN_OPTIONS: PlanOption[] = [
  {
    tier: 'solo',
    name: 'Solo',
    description: 'Personal account with private workflows.',
    price: 'Free'
  },
  {
    tier: 'workspace',
    name: 'Workspace',
    description: 'One shared workspace for your team.',
    price: '$29/mo'
  }
]

export default function PlanTab() {
  const { user, checkAuth, memberships } = useAuth()
  const [planOptions, setPlanOptions] = useState<PlanOption[]>(
    FALLBACK_PLAN_OPTIONS
  )
  const [selected, setSelected] = useState<PlanTier>(
    normalizePlanTier(user?.plan)
  )
  const [currentPlan, setCurrentPlan] = useState<PlanTier>(
    normalizePlanTier(user?.plan)
  )
  const [workspaceName, setWorkspaceName] = useState(() => {
    if (!Array.isArray(memberships)) return ''
    const membership = memberships[0]
    const name = membership?.workspace?.name
    return typeof name === 'string' ? name : ''
  })
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const workspaceEditedRef = useRef(false)

  const previousWorkspaceName = useMemo(() => {
    if (!Array.isArray(memberships)) return ''
    for (const membership of memberships) {
      const name =
        typeof membership?.workspace?.name === 'string'
          ? membership.workspace.name.trim()
          : ''
      if (name) {
        return name
      }
    }
    return ''
  }, [memberships])

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/workspaces/onboarding`, {
          credentials: 'include'
        })
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        if (!data) return
        const options: PlanOption[] = Array.isArray(data.plan_options)
          ? data.plan_options
              .map((option: any) => {
                const tier = normalizePlanTier(option?.tier)
                const fallback = FALLBACK_PLAN_OPTIONS.find(
                  (candidate) => candidate.tier === tier
                )
                return {
                  tier,
                  name:
                    typeof option?.name === 'string' && option.name.trim()
                      ? option.name
                      : (fallback?.name ?? 'Plan'),
                  description:
                    typeof option?.description === 'string'
                      ? option.description
                      : (fallback?.description ?? ''),
                  price:
                    typeof option?.price === 'string' && option.price.trim()
                      ? option.price
                      : (fallback?.price ?? '')
                }
              })
              .filter(
                (option): option is PlanOption =>
                  option.tier === 'solo' || option.tier === 'workspace'
              )
          : FALLBACK_PLAN_OPTIONS

        setPlanOptions(options.length > 0 ? options : FALLBACK_PLAN_OPTIONS)
        if (data.user?.plan) {
          const detectedPlan = normalizePlanTier(data.user.plan)
          setSelected(detectedPlan)
          setCurrentPlan(detectedPlan)
        }
        if (Array.isArray(data.memberships)) {
          const membershipName = data.memberships
            .map((membership: any) => {
              const candidate = membership?.workspace?.name
              return typeof candidate === 'string' ? candidate.trim() : ''
            })
            .find((name: string) => Boolean(name))

          if (membershipName && !workspaceEditedRef.current) {
            setWorkspaceName(membershipName)
          }
        }
      } catch (err) {
        console.error(err)
      }
    }

    fetchOptions()
  }, [])

  useEffect(() => {
    const normalizedPlan = normalizePlanTier(user?.plan)
    setSelected(normalizedPlan)
    setCurrentPlan(normalizedPlan)
  }, [user?.plan])

  useEffect(() => {
    if (selected !== 'workspace') return
    if (workspaceEditedRef.current) return
    if (!previousWorkspaceName) return
    setWorkspaceName(previousWorkspaceName)
  }, [selected, previousWorkspaceName])

  const canConfigureWorkspace = selected === 'workspace'

  const selectedPlanDetails = useMemo(
    () => planOptions.find((option) => option.tier === selected),
    [planOptions, selected]
  )

  const currentPlanDetails = useMemo(
    () => planOptions.find((option) => option.tier === currentPlan),
    [planOptions, currentPlan]
  )

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatus(null)
    setError(null)

    if (canConfigureWorkspace && !workspaceName.trim()) {
      setError('Workspace name is required for this plan')
      return
    }

    setIsSubmitting(true)
    try {
      const payload: Record<string, any> = {
        plan_tier: selected
      }
      if (canConfigureWorkspace) {
        payload.workspace_name = workspaceName.trim()
      }

      const csrfToken = await getCsrfToken()

      const res = await fetch(`${API_BASE_URL}/api/workspaces/plan`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify(payload)
      })

      const body = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(body?.message ?? 'Failed to update plan')
      }

      if (canConfigureWorkspace) {
        const membershipName = Array.isArray(body?.memberships)
          ? body.memberships
              .map((membership: any) => {
                const candidate = membership?.workspace?.name
                return typeof candidate === 'string' ? candidate.trim() : ''
              })
              .find((name: string) => Boolean(name))
          : ''

        const resolvedWorkspaceName =
          membershipName || workspaceName.trim() || previousWorkspaceName

        if (resolvedWorkspaceName) {
          workspaceEditedRef.current = false
          setWorkspaceName(resolvedWorkspaceName)
        }
      } else {
        workspaceEditedRef.current = false
        setWorkspaceName('')
      }

      setCurrentPlan(selected)

      await checkAuth({ silent: true })
      const planName = selectedPlanDetails?.name ?? 'selected plan'
      setStatus(`The ${planName} plan is now active.`)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to update plan')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleWorkspaceInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!workspaceEditedRef.current) {
      workspaceEditedRef.current = true
    }
    setWorkspaceName(event.target.value)
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Subscription plan
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upgrade or downgrade your DSentr plan at any time. Changes take effect
          immediately.
        </p>
      </div>

      {status ? (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300">
          {status}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {planOptions.map((option) => {
          const isSelected = option.tier === selected
          return (
            <button
              key={option.tier}
              type="button"
              onClick={() => setSelected(option.tier)}
              className={`rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                isSelected
                  ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400/70 dark:bg-indigo-500/10'
                  : 'border-zinc-200 dark:border-zinc-800 hover:border-indigo-300'
              }`}
            >
              <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {option.name}
              </span>
              <span className="mt-1 block text-sm font-medium text-indigo-600 dark:text-indigo-300">
                {option.price}
              </span>
              <span className="mt-2 block text-sm text-zinc-600 dark:text-zinc-400">
                {option.description}
              </span>
            </button>
          )
        })}
      </div>

      <div className="space-y-4">
        {canConfigureWorkspace ? (
          <label className="block">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Workspace name
            </span>
            <input
              type="text"
              value={workspaceName}
              onChange={handleWorkspaceInputChange}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              placeholder="Acme Workspace"
            />
          </label>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The solo plan keeps your workflows private to your account.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-70"
        >
          {isSubmitting ? 'Updating…' : 'Update plan'}
        </button>
      </div>

      {currentPlanDetails ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Current plan: {currentPlanDetails.name}
        </p>
      ) : null}
    </form>
  )
}

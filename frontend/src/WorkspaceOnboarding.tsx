import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '@/lib'
import { getCsrfToken } from '@/lib/csrfCache'
import { useAuth } from '@/stores/auth'
import { normalizePlanTier, type PlanTier } from '@/lib/planTiers'

type PlanOption = {
  tier: PlanTier
  name: string
  description: string
  price: string
}

type WorkflowSummary = {
  id: string
  name: string
  description?: string | null
  workspace_id?: string | null
}

type OnboardingContext = {
  user: {
    first_name: string
    last_name: string
    company_name?: string | null
    plan?: string | null
  }
  workflows: WorkflowSummary[]
  planOptions: PlanOption[]
}

const FALLBACK_PLAN_OPTIONS: PlanOption[] = [
  {
    tier: 'solo',
    name: 'Solo',
    description: 'For individuals automating personal workflows.',
    price: 'Free'
  },
  {
    tier: 'workspace',
    name: 'Workspace',
    description: 'Invite collaborators into one shared workspace.',
    price: '$29/mo'
  }
]

function defaultWorkspaceName(user: OnboardingContext['user']): string {
  const fallback = `${user.first_name ?? 'My'} Workspace`
  const candidate = user.company_name?.trim()
  return candidate && candidate.length > 0 ? `${candidate} Workspace` : fallback
}

export default function WorkspaceOnboarding() {
  const navigate = useNavigate()
  const { checkAuth } = useAuth()
  const [context, setContext] = useState<OnboardingContext | null>(null)
  const [planTier, setPlanTier] = useState<PlanTier>('solo')
  const [workspaceName, setWorkspaceName] = useState('')
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(
    new Set()
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        const res = await fetch(`${API_BASE_URL}/api/workspaces/onboarding`, {
          credentials: 'include'
        })
        if (!res.ok) throw new Error('Failed to load onboarding context')
        const data = await res.json()

        const workflows: WorkflowSummary[] = Array.isArray(data.workflows)
          ? data.workflows
          : []

        const planOptions: PlanOption[] = Array.isArray(data.plan_options)
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
                (option: PlanOption): option is PlanOption =>
                  option.tier === 'solo' || option.tier === 'workspace'
              )
          : FALLBACK_PLAN_OPTIONS

        const user = data.user ?? {
          first_name: '',
          last_name: ''
        }

        setContext({
          user,
          workflows,
          planOptions:
            planOptions.length > 0 ? planOptions : FALLBACK_PLAN_OPTIONS
        })

        const detectedPlan = normalizePlanTier(user.plan)
        setPlanTier(detectedPlan)
        setWorkspaceName(defaultWorkspaceName(user))
        setSelectedWorkflows(
          new Set(
            workflows
              .filter((wf) => Boolean(wf.workspace_id))
              .map((wf) => wf.id)
          )
        )
      } catch (err) {
        console.error(err)
        setError(
          'Unable to load onboarding data. Please refresh and try again.'
        )
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [])

  useEffect(() => {
    const normalized = normalizePlanTier(context?.user?.plan ?? null)
    setPlanTier(normalized)
  }, [context?.user?.plan])

  const availablePlanOptions = useMemo(
    () => context?.planOptions ?? FALLBACK_PLAN_OPTIONS,
    [context]
  )

  const availableWorkflows = useMemo(() => context?.workflows ?? [], [context])

  const canConfigureWorkspace = planTier === 'workspace'

  const toggleWorkflow = (id: string) => {
    if (!canConfigureWorkspace) return
    setSelectedWorkflows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (canConfigureWorkspace && !workspaceName.trim()) {
      setError('Workspace name is required for this plan')
      return
    }

    setIsSubmitting(true)
    try {
      const payload: Record<string, any> = {
        plan_tier: planTier
      }

      if (canConfigureWorkspace) {
        payload.workspace_name = workspaceName.trim()
        payload.shared_workflow_ids = Array.from(selectedWorkflows)
      }

      const csrfToken = await getCsrfToken()

      const res = await fetch(`${API_BASE_URL}/api/workspaces/onboarding`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? 'Failed to complete onboarding')
      }

      await checkAuth()
      navigate('/dashboard', { replace: true })
    } catch (err) {
      console.error(err)
      setError(
        err instanceof Error ? err.message : 'Failed to complete onboarding'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-600 dark:text-zinc-300">
          Loading onboarding experience...
        </div>
      </div>
    )
  }

  const selectedPlanDetails = availablePlanOptions.find(
    (option) => option.tier === planTier
  )

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-12">
      <div className="max-w-3xl mx-auto bg-white dark:bg-zinc-900 shadow-sm border border-zinc-200/60 dark:border-zinc-800 rounded-xl p-8">
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Set up your DSentr account
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mb-8">
          Pick the plan that fits and finish configuring your personal or shared
          workspace.
        </p>

        {error ? (
          <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form className="space-y-8" onSubmit={handleSubmit}>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Choose a plan
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Plans determine whether you automate solo or invite collaborators
              into one workspace.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {availablePlanOptions.map((option) => {
                const isSelected = option.tier === planTier
                return (
                  <button
                    key={option.tier}
                    type="button"
                    onClick={() => setPlanTier(option.tier)}
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
            {selectedPlanDetails ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                You selected the{' '}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {selectedPlanDetails.name}
                </span>{' '}
                tier ({selectedPlanDetails.price}).
              </p>
            ) : null}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Workspace basics
            </h2>
            {canConfigureWorkspace ? (
              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Workspace name
                </span>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="Acme Workspace"
                />
              </label>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                The solo plan keeps everything private to you. Upgrade later to
                collaborate in a shared workspace.
              </p>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Share workflows
            </h2>
            {canConfigureWorkspace ? (
              availableWorkflows.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  You don’t have any workflows yet. You can create workflows
                  once onboarding is complete.
                </p>
              ) : (
                <div className="grid gap-3">
                  {availableWorkflows.map((workflow) => (
                    <label
                      key={workflow.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                        checked={selectedWorkflows.has(workflow.id)}
                        onChange={() => toggleWorkflow(workflow.id)}
                      />
                      <span>
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {workflow.name}
                        </span>
                        {workflow.description ? (
                          <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                            {workflow.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              )
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Shared workflows are available when you upgrade to the workspace
                plan.
              </p>
            )}
          </section>

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? 'Saving...' : 'Complete setup'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

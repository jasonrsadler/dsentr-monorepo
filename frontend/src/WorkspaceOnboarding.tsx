import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '@/lib'
import { getCsrfToken } from '@/lib/csrfCache'
import { useAuth } from '@/stores/auth'

type PlanTier = 'solo' | 'workspace' | 'organization'

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

type TeamDraft = {
  id: string
  name: string
}

const FALLBACK_PLAN_OPTIONS: PlanOption[] = [
  {
    tier: 'solo',
    name: 'Solo',
    description: 'For individuals building personal automations.',
    price: 'Free'
  },
  {
    tier: 'workspace',
    name: 'Workspace',
    description: 'Invite collaborators into a single shared workspace.',
    price: '$29/mo'
  },
  {
    tier: 'organization',
    name: 'Organization',
    description: 'Manage multiple workspaces under one organization.',
    price: '$99/mo'
  }
]

function normalizePlan(plan?: string | null): PlanTier {
  switch ((plan ?? '').toLowerCase()) {
    case 'workspace':
      return 'workspace'
    case 'organization':
      return 'organization'
    default:
      return 'solo'
  }
}

function defaultWorkspaceName(user: OnboardingContext['user']): string {
  const fallback = `${user.first_name ?? 'My'} Workspace`
  const candidate = user.company_name?.trim()
  return candidate && candidate.length > 0 ? `${candidate} Workspace` : fallback
}

function createLocalId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

export default function WorkspaceOnboarding() {
  const navigate = useNavigate()
  const { checkAuth } = useAuth()
  const [context, setContext] = useState<OnboardingContext | null>(null)
  const [planTier, setPlanTier] = useState<PlanTier>('solo')
  const [workspaceName, setWorkspaceName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [teams, setTeams] = useState<TeamDraft[]>([])
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
                const normalizedTier = normalizePlan(option?.tier)
                const fallbackOption = FALLBACK_PLAN_OPTIONS.find(
                  (fallback) => fallback.tier === normalizedTier
                )

                const name =
                  typeof option?.name === 'string' &&
                  option.name.trim().length > 0
                    ? option.name
                    : (fallbackOption?.name ?? 'Plan')

                const description =
                  typeof option?.description === 'string' &&
                  option.description.trim().length > 0
                    ? option.description
                    : (fallbackOption?.description ?? '')

                const price =
                  typeof option?.price === 'string' &&
                  option.price.trim().length > 0
                    ? option.price
                    : (fallbackOption?.price ?? '')

                return {
                  tier: normalizedTier,
                  name,
                  description,
                  price
                }
              })
              .filter(
                (option): option is PlanOption =>
                  option.tier === 'solo' ||
                  option.tier === 'workspace' ||
                  option.tier === 'organization'
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

        const detectedPlan = normalizePlan(user.plan)
        setPlanTier(detectedPlan)
        setWorkspaceName(defaultWorkspaceName(user))
        setOrganizationName(user.company_name?.trim() ?? '')
        setTeams([])
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

  const availablePlanOptions = useMemo(
    () => context?.planOptions ?? FALLBACK_PLAN_OPTIONS,
    [context]
  )

  const availableWorkflows = useMemo(() => context?.workflows ?? [], [context])

  const canConfigureWorkspace = planTier !== 'solo'
  const needsOrganizationName = planTier === 'organization'

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

  const updateTeamName = (id: string, name: string) => {
    setTeams((prev) =>
      prev.map((team) => (team.id === id ? { ...team, name } : team))
    )
  }

  const addTeam = () => {
    if (!canConfigureWorkspace) return
    setTeams((prev) => [...prev, { id: createLocalId(), name: '' }])
  }

  const removeTeam = (id: string) => {
    setTeams((prev) => prev.filter((team) => team.id !== id))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (canConfigureWorkspace && !workspaceName.trim()) {
      setError('Workspace name is required for this plan')
      return
    }

    if (needsOrganizationName && !organizationName.trim()) {
      setError('Organization name is required for this plan')
      return
    }

    setIsSubmitting(true)
    try {
      const payload: Record<string, any> = {
        plan_tier: planTier,
        teams: canConfigureWorkspace
          ? teams
              .filter((team) => team.name.trim().length > 0)
              .map((team) => ({ name: team.name.trim(), member_ids: [] }))
          : [],
        shared_workflow_ids: canConfigureWorkspace
          ? Array.from(selectedWorkflows)
          : []
      }

      if (canConfigureWorkspace) {
        payload.workspace_name = workspaceName.trim()
      }
      if (needsOrganizationName) {
        payload.organization_name = organizationName.trim()
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
      <div className="max-w-4xl mx-auto bg-white dark:bg-zinc-900 shadow-sm border border-zinc-200/60 dark:border-zinc-800 rounded-xl p-8">
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Configure your DSentr environment
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mb-8">
          Choose the plan that fits your team and decide how you want to share
          workflows on day one.
        </p>

        {error ? (
          <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form className="space-y-8" onSubmit={handleSubmit}>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Pick a plan
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Plan tiers determine how many collaborators and workspaces you can
              manage.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
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
                You have selected the{' '}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {selectedPlanDetails.name}
                </span>{' '}
                tier ({selectedPlanDetails.price}).
              </p>
            ) : null}
          </section>

          {canConfigureWorkspace ? (
            <section className="space-y-4">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Workspace basics
              </h2>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Workspace name
                </span>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="Acme Automation"
                />
              </label>

              {needsOrganizationName ? (
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Organization name
                  </span>
                  <input
                    type="text"
                    value={organizationName}
                    onChange={(event) =>
                      setOrganizationName(event.target.value)
                    }
                    className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="Acme Holdings"
                  />
                </label>
              ) : null}
            </section>
          ) : (
            <section className="space-y-2">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Workspace basics
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                The solo plan keeps everything private to your personal account.
                Upgrade later to collaborate with a team.
              </p>
            </section>
          )}

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Teams
              </h2>
              <button
                type="button"
                onClick={addTeam}
                disabled={!canConfigureWorkspace}
                className={`inline-flex items-center rounded-md border px-3 py-1 text-sm font-medium transition ${
                  canConfigureWorkspace
                    ? 'border-indigo-500 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10'
                    : 'cursor-not-allowed border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'
                }`}
              >
                + Add team
              </button>
            </div>

            {canConfigureWorkspace ? (
              teams.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Create teams to organize permissions. You can invite
                  additional members later.
                </p>
              ) : null
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Upgrade to a workspace or organization plan to group
                collaborators into teams.
              </p>
            )}

            {canConfigureWorkspace ? (
              <div className="space-y-3">
                {teams.map((team) => (
                  <div
                    key={team.id}
                    className="rounded-lg border border-zinc-200/70 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-1 space-y-2">
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          Team name
                          <input
                            type="text"
                            value={team.name}
                            onChange={(event) =>
                              updateTeamName(team.id, event.target.value)
                            }
                            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                            placeholder="Growth Ops"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTeam(team.id)}
                        className="text-sm text-red-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Members can be invited after onboarding. For now, teams
                      act as folders for shared workflows.
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
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
                Shared workflows are disabled on the solo plan. Upgrade at any
                time from Settings → Plan to collaborate with your team.
              </p>
            )}
          </section>

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? 'Saving...' : 'Save and continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

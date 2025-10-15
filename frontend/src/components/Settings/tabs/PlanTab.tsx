import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { API_BASE_URL } from '@/lib'
import { normalizePlanTier, type PlanTier } from '@/lib/planTiers'
import {
  orgDowngradePreview,
  orgDowngradeExecute,
  workspaceToSoloPreview,
  workspaceToSoloExecute
} from '@/lib/orgWorkspaceApi'
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
  },
  {
    tier: 'organization',
    name: 'Organization',
    description: 'Multiple workspaces with centralized control.',
    price: '$99/mo'
  }
]

export default function PlanTab() {
  const { user, checkAuth, memberships, organizationMemberships } = useAuth()
  const [planOptions, setPlanOptions] = useState<PlanOption[]>(
    FALLBACK_PLAN_OPTIONS
  )
  const [selected, setSelected] = useState<PlanTier>(
    normalizePlanTier(user?.plan)
  )
  const [currentPlan, setCurrentPlan] = useState<PlanTier>(
    normalizePlanTier(user?.plan)
  )
  const [workspaceName, setWorkspaceName] = useState('')
  const [organizationName, setOrganizationName] = useState(
    typeof user?.companyName === 'string' ? user.companyName : ''
  )
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const workspaceEditedRef = useRef(false)
  const organizationEditedRef = useRef(false)

  // Advanced downgrade helpers
  const [downgradeTargetWorkspaceId, setDowngradeTargetWorkspaceId] = useState<string>('')
  const [downgradeAffectedUsers, setDowngradeAffectedUsers] = useState<string[]>([])
  const [downgradeTeams, setDowngradeTeams] = useState<{ id: string; name: string }[]>([])
  const [transferMap, setTransferMap] = useState<Record<string, string | ''>>({})
  const [downgradeBusy, setDowngradeBusy] = useState(false)
  const [workspaceSoloPreview, setWorkspaceSoloPreview] = useState<string[] | null>(null)

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

  const previousOrganizationName = useMemo(() => {
    if (Array.isArray(organizationMemberships)) {
      for (const membership of organizationMemberships) {
        const name =
          typeof membership?.organization?.name === 'string'
            ? membership.organization.name.trim()
            : ''
        if (name) {
          return name
        }
      }
    }

    if (typeof user?.companyName === 'string') {
      const trimmed = user.companyName.trim()
      if (trimmed) return trimmed
    }

    return ''
  }, [organizationMemberships, user?.companyName])

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
              .map((option: any) => ({
                tier: normalizePlanTier(option?.tier),
                name: typeof option?.name === 'string' ? option.name : 'Plan',
                description:
                  typeof option?.description === 'string'
                    ? option.description
                    : ''
              }))
              .filter(
                (option): option is PlanOption =>
                  option.tier === 'solo' ||
                  option.tier === 'workspace' ||
                  option.tier === 'organization'
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
        const organizationNameFromMembership = Array.isArray(
          data.organization_memberships
        )
          ? data.organization_memberships
              .map((membership: any) => {
                const candidate = membership?.organization?.name
                return typeof candidate === 'string' ? candidate.trim() : ''
              })
              .find((name: string) => Boolean(name))
          : ''

        const organizationNameFromUser =
          typeof data.user?.company_name === 'string'
            ? data.user.company_name.trim()
            : ''

        const resolvedOrganizationName =
          organizationNameFromMembership || organizationNameFromUser

        if (resolvedOrganizationName && !organizationEditedRef.current) {
          setOrganizationName(resolvedOrganizationName)
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

  const canConfigureWorkspace = selected !== 'solo'
  const needsOrganizationName = selected === 'organization'

  const selectedPlanDetails = useMemo(
    () => planOptions.find((option) => option.tier === selected),
    [planOptions, selected]
  )

  const currentPlanDetails = useMemo(
    () => planOptions.find((option) => option.tier === currentPlan),
    [planOptions, currentPlan]
  )

  useEffect(() => {
    if (!canConfigureWorkspace) return
    if (workspaceEditedRef.current) return
    if (!previousWorkspaceName) return
    setWorkspaceName(previousWorkspaceName)
  }, [canConfigureWorkspace, previousWorkspaceName])

  useEffect(() => {
    if (!needsOrganizationName) return
    if (organizationEditedRef.current) return
    if (!previousOrganizationName) return
    setOrganizationName(previousOrganizationName)
  }, [needsOrganizationName, previousOrganizationName])

  const organizationId = useMemo(() => {
    // Pick first organization membership for admin view (simple heuristic)
    if (Array.isArray(organizationMemberships) && organizationMemberships[0]) {
      return organizationMemberships[0].organization.id
    }
    return ''
  }, [organizationMemberships])

  const orgWorkspaces = useMemo(() => {
    return Array.isArray(memberships)
      ? memberships
          .filter((m) => typeof (m as any)?.workspace?.organization_id === 'string' || (m as any)?.workspace?.organization_id)
          .map((m) => m.workspace)
      : []
  }, [memberships])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatus(null)
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
        plan_tier: selected,
        teams: [],
        shared_workflow_ids: []
      }
      if (canConfigureWorkspace) {
        payload.workspace_name = workspaceName.trim()
      }
      if (needsOrganizationName) {
        payload.organization_name = organizationName.trim()
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

      const trimmedWorkspaceName = canConfigureWorkspace
        ? workspaceName.trim()
        : ''
      const trimmedOrganizationName = needsOrganizationName
        ? organizationName.trim()
        : ''

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
          membershipName || trimmedWorkspaceName || previousWorkspaceName

        if (resolvedWorkspaceName) {
          workspaceEditedRef.current = false
          setWorkspaceName(resolvedWorkspaceName)
        }
      } else {
        workspaceEditedRef.current = false
        setWorkspaceName('')
      }

      if (needsOrganizationName) {
        const organizationNameFromMembership = Array.isArray(
          body?.organization_memberships
        )
          ? body.organization_memberships
              .map((membership: any) => {
                const candidate = membership?.organization?.name
                return typeof candidate === 'string' ? candidate.trim() : ''
              })
              .find((name: string) => Boolean(name))
          : ''

        const resolvedOrganizationName =
          organizationNameFromMembership ||
          trimmedOrganizationName ||
          previousOrganizationName

        if (resolvedOrganizationName) {
          organizationEditedRef.current = false
          setOrganizationName(resolvedOrganizationName)
        }
      } else {
        organizationEditedRef.current = false
        setOrganizationName(
          typeof user?.companyName === 'string' ? user.companyName : ''
        )
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

  // Advanced: Organization -> Workspace downgrade
  const handlePreviewOrgDowngrade = async () => {
    if (!downgradeTargetWorkspaceId || !organizationId) return
    try {
      setDowngradeBusy(true)
      setError(null)
      const result = await orgDowngradePreview(organizationId, downgradeTargetWorkspaceId)
      setDowngradeAffectedUsers(result.will_disable_users)
      setDowngradeTeams(result.teams)
      setTransferMap({})
      setStatus('Review affected users and choose transfers, then confirm downgrade.')
    } catch (e: any) {
      setError(e.message || 'Failed to preview downgrade')
    } finally {
      setDowngradeBusy(false)
    }
  }

  const handleExecuteOrgDowngrade = async () => {
    if (!downgradeTargetWorkspaceId || !organizationId) return
    try {
      setDowngradeBusy(true)
      setError(null)
      const transfers = Object.entries(transferMap)
        .filter(([_, team]) => team)
        .map(([user_id, team_id]) => ({ user_id, team_id }))
      await orgDowngradeExecute(organizationId, downgradeTargetWorkspaceId, transfers)
      await checkAuth({ silent: true })
      setStatus('Organization downgraded to workspace successfully.')
    } catch (e: any) {
      setError(e.message || 'Failed to execute downgrade')
    } finally {
      setDowngradeBusy(false)
    }
  }

  // Advanced: Workspace -> Solo downgrade
  const handlePreviewWorkspaceToSolo = async () => {
    const wsId = previousWorkspaceName ? (memberships.find((m) => m.workspace.name.trim() === previousWorkspaceName)?.workspace.id || '') : (memberships[0]?.workspace.id || '')
    if (!wsId) return
    try {
      setDowngradeBusy(true)
      const users = await workspaceToSoloPreview(wsId)
      setWorkspaceSoloPreview(users)
      setStatus('Users listed will lose access when confirming the downgrade.')
    } catch (e: any) {
      setError(e.message || 'Failed to preview workspace to solo')
    } finally {
      setDowngradeBusy(false)
    }
  }

  const handleExecuteWorkspaceToSolo = async () => {
    const wsId = previousWorkspaceName ? (memberships.find((m) => m.workspace.name.trim() === previousWorkspaceName)?.workspace.id || '') : (memberships[0]?.workspace.id || '')
    if (!wsId) return
    try {
      setDowngradeBusy(true)
      await workspaceToSoloExecute(wsId)
      await checkAuth({ silent: true })
      setStatus('Workspace downgraded to Solo; only owner retains access.')
    } catch (e: any) {
      setError(e.message || 'Failed to downgrade to solo')
    } finally {
      setDowngradeBusy(false)
    }
  }

  const handleWorkspaceInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!workspaceEditedRef.current) {
      workspaceEditedRef.current = true
    }
    setWorkspaceName(event.target.value)
  }

  const handleOrganizationInputChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    if (!organizationEditedRef.current) {
      organizationEditedRef.current = true
    }
    setOrganizationName(event.target.value)
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

      <div className="grid gap-3 md:grid-cols-3">
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

        {needsOrganizationName ? (
          <label className="block">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Organization name
            </span>
            <input
              type="text"
              value={organizationName}
              onChange={handleOrganizationInputChange}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              placeholder="Acme Holdings"
            />
          </label>
        ) : null}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? 'Updating…' : 'Update plan'}
        </button>
      </div>

      {currentPlanDetails ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Current plan: {currentPlanDetails.name}
        </p>
      ) : null}

      {/* Advanced downgrade tools */}
      <div className="mt-4 border-t pt-4 space-y-3">
        <h4 className="font-semibold">Advanced actions</h4>
        {currentPlan === 'organization' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-sm">Downgrade to workspace</label>
              <select
                value={downgradeTargetWorkspaceId}
                onChange={(e) => setDowngradeTargetWorkspaceId(e.target.value)}
                className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
              >
                <option value="">Select workspace…</option>
                {orgWorkspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handlePreviewOrgDowngrade}
                disabled={!downgradeTargetWorkspaceId || downgradeBusy}
                className="px-3 py-1 text-sm rounded border"
              >
                Preview downgrade
              </button>
            </div>

            {downgradeAffectedUsers.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  The following users will lose access unless transferred to a team in the selected workspace:
                </p>
                <div className="space-y-1">
                  {downgradeAffectedUsers.map((uid) => (
                    <div key={uid} className="flex items-center gap-2">
                      <span className="font-mono text-xs">{uid}</span>
                      <select
                        value={transferMap[uid] ?? ''}
                        onChange={(e) =>
                          setTransferMap((prev) => ({ ...prev, [uid]: e.target.value }))
                        }
                        className="px-2 py-1 text-xs border rounded"
                      >
                        <option value="">Do not transfer</option>
                        {downgradeTeams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleExecuteOrgDowngrade}
                  disabled={downgradeBusy}
                  className="px-3 py-1 text-sm rounded bg-amber-600 text-white"
                >
                  Confirm downgrade
                </button>
              </div>
            )}
          </div>
        )}

        {currentPlan === 'workspace' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">Downgrade workspace to Solo</span>
              <button
                type="button"
                onClick={handlePreviewWorkspaceToSolo}
                disabled={downgradeBusy}
                className="px-3 py-1 text-sm rounded border"
              >
                Preview
              </button>
            </div>
            {Array.isArray(workspaceSoloPreview) && (
              <div className="space-y-1">
                {workspaceSoloPreview.length === 0 ? (
                  <p className="text-sm text-zinc-600">No other users will be removed.</p>
                ) : (
                  <>
                    <p className="text-sm text-zinc-600">
                      These users will be removed from the workspace:
                    </p>
                    <ul className="pl-4 list-disc">
                      {workspaceSoloPreview.map((u) => (
                        <li key={u} className="font-mono text-xs">{u}</li>
                      ))}
                    </ul>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleExecuteWorkspaceToSolo}
                  disabled={downgradeBusy}
                  className="px-3 py-1 text-sm rounded bg-amber-600 text-white"
                >
                  Confirm downgrade to Solo
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  )
}

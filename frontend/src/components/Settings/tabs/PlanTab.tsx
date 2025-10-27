import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { API_BASE_URL } from '@/lib'
import { STRIPE_PUBLISHABLE_KEY } from '@/lib'
import { loadStripe } from '@stripe/stripe-js'
import { normalizePlanTier, type PlanTier } from '@/lib/planTiers'
import { getCsrfToken } from '@/lib/csrfCache'
import type { WorkspaceMembershipSummary } from '@/lib/orgWorkspaceApi'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'

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
  const user = useAuth((state) => state.user)
  const checkAuth = useAuth((state) => state.checkAuth)
  const setCurrentWorkspaceId = useAuth((state) => state.setCurrentWorkspaceId)
  const memberships = useAuth((state) => state.memberships)
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const effectivePlan = useMemo<PlanTier>(
    () =>
      normalizePlanTier(
        currentWorkspace?.workspace.plan ?? user?.plan ?? undefined
      ),
    [currentWorkspace?.workspace.plan, user?.plan]
  )
  const previousWorkspaceName = useMemo(() => {
    const activeName = currentWorkspace?.workspace?.name
    if (typeof activeName === 'string' && activeName.trim()) {
      return activeName.trim()
    }
    if (!Array.isArray(memberships)) return ''
    for (const membership of memberships) {
      const candidate = membership?.workspace?.name
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }
    return ''
  }, [currentWorkspace?.workspace?.name, memberships])
  const [planOptions, setPlanOptions] = useState<PlanOption[]>(
    FALLBACK_PLAN_OPTIONS
  )
  const [selected, setSelected] = useState<PlanTier>(effectivePlan)
  const [currentPlan, setCurrentPlan] = useState<PlanTier>(effectivePlan)
  const [workspaceName, setWorkspaceName] = useState(previousWorkspaceName)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [renewsAt, setRenewsAt] = useState<string | null>(null)
  const [revertsAt, setRevertsAt] = useState<string | null>(null)
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  const [isResuming, setIsResuming] = useState(false)
  const workspaceEditedRef = useRef(false)
  const isWorkspaceOwner = currentWorkspace?.role === 'owner'

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
                (option: PlanOption): option is PlanOption =>
                  option.tier === 'solo' || option.tier === 'workspace'
              )
          : FALLBACK_PLAN_OPTIONS

        setPlanOptions(options.length > 0 ? options : FALLBACK_PLAN_OPTIONS)

        let detectedPlan: PlanTier | null = null

        if (Array.isArray(data.memberships)) {
          const membershipList =
            data.memberships as WorkspaceMembershipSummary[]
          const activeMembership = selectCurrentWorkspace({
            memberships: membershipList,
            currentWorkspaceId: useAuth.getState().currentWorkspaceId
          })

          if (activeMembership?.workspace?.plan) {
            detectedPlan = normalizePlanTier(activeMembership.workspace.plan)
          }

          const membershipName =
            activeMembership?.workspace?.name?.trim() ||
            membershipList
              .map((membership) => {
                const candidate = membership?.workspace?.name
                return typeof candidate === 'string' ? candidate.trim() : ''
              })
              .find((name) => Boolean(name)) ||
            ''

          if (membershipName && !workspaceEditedRef.current) {
            setWorkspaceName(membershipName)
          }
        }

        if (!detectedPlan && data.user?.plan) {
          detectedPlan = normalizePlanTier(data.user.plan)
        }

        if (detectedPlan) {
          setSelected(detectedPlan)
          setCurrentPlan(detectedPlan)
        }

        // Subscription billing info (renewal/cancel dates)
        const sub = data?.billing?.subscription
        if (sub && typeof sub === 'object') {
          let renewIso: string | null = null
          if (typeof sub.renews_at === 'string') renewIso = sub.renews_at
          let cancelIso: string | null = null
          if (typeof sub.cancel_at === 'string') cancelIso = sub.cancel_at
          const cancelFlag = Boolean(sub.cancel_at_period_end)
          setRenewsAt(renewIso)
          setRevertsAt(cancelIso)
          setCancelAtPeriodEnd(cancelFlag)
        } else {
          setRenewsAt(null)
          setRevertsAt(null)
          setCancelAtPeriodEnd(false)
        }
      } catch (err) {
        console.error(err)
      }
    }

    fetchOptions()
  }, [])

  // When returning from Stripe Checkout, open Plan tab shows either success or cancel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const billing = params.get('billing')
    if (!billing) return

    const cleanupParams = () => {
      try {
        const p = new URLSearchParams(window.location.search)
        p.delete('billing')
        p.delete('session_id')
        const path = window.location.pathname + (p.toString() ? `?${p}` : '')
        window.history.replaceState({}, '', path)
      } catch (_err) {
        // ignore
        void _err
      }
    }

    if (billing === 'cancel') {
      setStatus(null)
      setError('Checkout canceled. No changes were made.')
      cleanupParams()
      return
    }

    if (billing === 'success') {
      setIsConfirming(true)
      setStatus('Finalizing your subscription…')
      ;(async () => {
        try {
          const maxAttempts = import.meta.env?.MODE === 'test' ? 1 : 10
          for (let i = 0; i < maxAttempts; i++) {
            const res = await fetch(
              `${API_BASE_URL}/api/workspaces/onboarding`,
              {
                credentials: 'include'
              }
            )
            if (!res.ok) break
            const data = await res.json().catch(() => null)
            const lastError = data?.billing?.last_error
            const hasPending = Boolean(data?.billing?.has_pending_checkout)
            if (lastError) {
              setStatus(null)
              setError(String(lastError))
              setSelected('solo')
              break
            }
            if (!hasPending) {
              await checkAuth({ silent: true })
              setCurrentPlan('workspace')
              setStatus('The Workspace plan is now active.')
              const state = useAuth.getState()
              const ownedWorkspace = (state.memberships || []).find(
                (m: any) =>
                  (m?.role ?? '').toLowerCase() === 'owner' &&
                  (m?.workspace?.plan ?? '').toLowerCase() === 'workspace'
              )
              if (ownedWorkspace?.workspace?.id) {
                setCurrentWorkspaceId(ownedWorkspace.workspace.id)
              }
              break
            }
            await new Promise((r) => setTimeout(r, 500))
          }
        } catch (err) {
          console.error(err)
          setStatus(null)
          setError('We could not verify your subscription. Please retry.')
        } finally {
          cleanupParams()
          setIsConfirming(false)
        }
      })()
    }
  }, [checkAuth, setCurrentWorkspaceId])

  useEffect(() => {
    setSelected((prev) => (prev === effectivePlan ? prev : effectivePlan))
    setCurrentPlan((prev) => (prev === effectivePlan ? prev : effectivePlan))
  }, [effectivePlan])

  useEffect(() => {
    if (selected !== 'workspace') return
    if (workspaceEditedRef.current) return
    if (!previousWorkspaceName) return
    setWorkspaceName(previousWorkspaceName)
  }, [selected, previousWorkspaceName])

  useEffect(() => {
    if (selected === 'workspace') return
    if (workspaceEditedRef.current) return
    setWorkspaceName('')
  }, [selected])

  const canConfigureWorkspace = selected === 'workspace'

  const selectedPlanDetails = useMemo(
    () => planOptions.find((option) => option.tier === selected),
    [planOptions, selected]
  )

  const currentPlanDetails = useMemo(
    () => planOptions.find((option) => option.tier === currentPlan),
    [planOptions, currentPlan]
  )

  const formattedReverts = useMemo(() => {
    if (!revertsAt) return null
    try {
      return new Date(revertsAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    } catch {
      return null
    }
  }, [revertsAt])

  const formattedRenews = useMemo(() => {
    if (!renewsAt) return null
    try {
      return new Date(renewsAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    } catch {
      return null
    }
  }, [renewsAt])

  const soloDowngradeNote = useMemo(() => {
    if (cancelAtPeriodEnd && formattedReverts) {
      return `Your account will remain on the Workspace plan until ${formattedReverts}. After this date, it will revert to Solo.`
    }
    if (formattedRenews) {
      return `If you continue, your account will remain on the Workspace plan until ${formattedRenews}. You won’t be charged again.`
    }
    return null
  }, [cancelAtPeriodEnd, formattedReverts, formattedRenews])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatus(null)
    setError(null)

    if (!isWorkspaceOwner) {
      setError('Only workspace owners can modify billing settings.')
      return
    }

    if (selected === currentPlan) {
      setError('This plan is already active.')
      return
    }

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

      // Workspace plan now returns a Stripe Checkout URL to start billing.
      if (canConfigureWorkspace && (body?.checkout_url || body?.checkoutUrl)) {
        const checkoutUrl: string = body.checkout_url || body.checkoutUrl
        setIsRedirecting(true)
        setStatus('Redirecting to Stripe Checkout…')
        try {
          // Prefer redirect via Stripe.js when available.
          if (STRIPE_PUBLISHABLE_KEY) {
            const stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY)
            // If backend ever returns a session id, use it; otherwise fall back to URL navigation.
            const sessionId: string | undefined =
              body.session_id || body.sessionId
            if (stripe && sessionId) {
              await stripe.redirectToCheckout({ sessionId })
            } else {
              window.location.assign(checkoutUrl)
            }
          } else {
            // No publishable key configured; fall back to a direct navigation.
            window.location.assign(checkoutUrl)
          }
        } catch {
          setIsRedirecting(false)
        }
        return
      }

      // Non-workspace plan path (solo). For Stripe subscribers, backend may schedule downgrade at period end.
      if (canConfigureWorkspace) {
        // If we got here for workspace, backend may still send memberships on legacy flows.
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
        // Solo selected
        if (body?.scheduled_downgrade?.effective_at) {
          // Downgrade scheduled for end of period; keep current plan as workspace
          const dt = body.scheduled_downgrade.effective_at as string
          setRevertsAt(dt)
          setCancelAtPeriodEnd(true)
          setSelected('workspace')
          setCurrentPlan('workspace')
          const formatted = new Date(dt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
          setStatus(
            `Workspace subscription will revert back to Solo on ${formatted}.`
          )
        } else {
          // Immediate downgrade path (non-Stripe or no active subscription)
          workspaceEditedRef.current = false
          setWorkspaceName('')
          setCurrentPlan(selected)
          await checkAuth({ silent: true })
          const planName = selectedPlanDetails?.name ?? 'selected plan'
          setStatus(`The ${planName} plan is now active.`)
        }
      }
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

  const activeWorkspaceName = useMemo(() => {
    const candidate = currentWorkspace?.workspace?.name?.trim()
    if (candidate) return candidate
    if (workspaceName.trim()) return workspaceName.trim()
    if (previousWorkspaceName.trim()) return previousWorkspaceName.trim()
    return ''
  }, [currentWorkspace?.workspace?.name, previousWorkspaceName, workspaceName])

  const ownershipMessage = isWorkspaceOwner
    ? null
    : 'Only workspace owners can modify billing settings.'
  const planName = currentPlanDetails?.name ?? 'current'
  const workspaceLabel = activeWorkspaceName || 'This workspace'
  const planSummaryMessage = `${workspaceLabel} is currently on the ${planName} plan.`

  const InfoIcon = (
    <svg
      className="inline-block h-4 w-4 align-text-bottom text-zinc-500 dark:text-zinc-400"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM9 9.25a.75.75 0 000 1.5h.5v3.5a.75.75 0 001.5 0v-4.25A.75.75 0 0010.25 9H9z"
        clipRule="evenodd"
      />
    </svg>
  )

  const handleResumeSubscription = async () => {
    setStatus(null)
    setError(null)
    setIsResuming(true)
    try {
      const csrfToken = await getCsrfToken()
      const res = await fetch(
        `${API_BASE_URL}/api/workspaces/billing/subscription/resume`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'x-csrf-token': csrfToken
          }
        }
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.message || 'Failed to resume subscription')
      }
      // Refresh subscription state via onboarding endpoint
      const r = await fetch(`${API_BASE_URL}/api/workspaces/onboarding`, {
        credentials: 'include'
      })
      const data = await r.json().catch(() => null)
      const sub = data?.billing?.subscription
      const renewIso = typeof sub?.renews_at === 'string' ? sub.renews_at : null
      setRenewsAt(renewIso)
      setRevertsAt(null)
      setCancelAtPeriodEnd(false)
      setStatus(
        renewIso
          ? `Subscription resumed. Your plan renews on ${new Date(renewIso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.`
          : 'Subscription resumed.'
      )
    } catch (err) {
      console.error(err)
      setError(
        err instanceof Error ? err.message : 'Failed to resume subscription'
      )
    } finally {
      setIsResuming(false)
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Subscription plan
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upgrades take effect immediately. Downgrades to Solo occur at the end
          of your current billing period.
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {planSummaryMessage}
          {ownershipMessage ? ` ${ownershipMessage}` : ''}
        </p>
        {currentPlan === 'workspace' ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {cancelAtPeriodEnd && formattedReverts ? (
              <span className="inline-flex items-center gap-1">
                {InfoIcon}
                <span>Workspace subscription will revert back to Solo on</span>
                <span className="whitespace-nowrap">{formattedReverts}.</span>
              </span>
            ) : formattedRenews ? (
              <span className="inline-flex items-center gap-1">
                {InfoIcon}
                <span>Renews on</span>
                <span className="whitespace-nowrap">{formattedRenews}.</span>
              </span>
            ) : null}
          </p>
        ) : null}
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
          const showCurrentBadge = option.tier === currentPlan && isSelected
          const showSoloDowngradeNote =
            option.tier === 'solo' &&
            selected === 'solo' &&
            currentPlan === 'workspace'
          return (
            <button
              key={option.tier}
              type="button"
              onClick={
                isWorkspaceOwner ? () => setSelected(option.tier) : undefined
              }
              disabled={!isWorkspaceOwner}
              className={`rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                isSelected
                  ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400/70 dark:bg-indigo-500/10'
                  : 'border-zinc-200 dark:border-zinc-800 hover:border-indigo-300'
              } ${
                isWorkspaceOwner
                  ? ''
                  : 'cursor-not-allowed opacity-70 hover:border-zinc-200 dark:hover:border-zinc-800'
              }`}
            >
              <span className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {option.name}
                {showCurrentBadge ? (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                    Current plan
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-sm font-medium text-indigo-600 dark:text-indigo-300">
                {option.price}
              </span>
              <span className="mt-2 block text-sm text-zinc-600 dark:text-zinc-400">
                {option.description}
              </span>
              {showSoloDowngradeNote && soloDowngradeNote ? (
                <span className="mt-2 block text-xs text-zinc-600 dark:text-zinc-400 inline-flex items-center gap-1">
                  {InfoIcon}
                  <span>{soloDowngradeNote}</span>
                </span>
              ) : null}
              {option.tier === 'workspace' &&
              currentPlan === 'workspace' &&
              cancelAtPeriodEnd &&
              formattedReverts ? (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-zinc-600 dark:text-zinc-400 inline-flex items-center gap-1">
                    {InfoIcon}
                    <span>Workspace subscription will revert to Solo on</span>
                    <span className="whitespace-nowrap">
                      {formattedReverts}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={
                      isWorkspaceOwner ? handleResumeSubscription : undefined
                    }
                    disabled={!isWorkspaceOwner || isResuming}
                    className="ml-3 inline-flex items-center rounded border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-900/20"
                    aria-label="Continue subscription"
                  >
                    {isResuming ? 'Resuming…' : 'Continue subscription'}
                  </button>
                </div>
              ) : null}
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
              disabled={!isWorkspaceOwner}
              className={[
                'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm',
                'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500',
                'disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500',
                'dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100',
                'dark:disabled:bg-zinc-900/60 dark:disabled:text-zinc-500'
              ].join(' ')}
              placeholder="Acme Workspace"
            />
            {!isWorkspaceOwner ? (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Workspace owners can update the workspace name when changing
                plans.
              </p>
            ) : null}
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
          disabled={
            isSubmitting ||
            isRedirecting ||
            isConfirming ||
            !isWorkspaceOwner ||
            selected === currentPlan ||
            cancelAtPeriodEnd // prevent further changes while a scheduled downgrade is pending
          }
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-400 disabled:opacity-80"
        >
          {isConfirming
            ? 'Finalizing…'
            : isRedirecting
              ? 'Redirecting…'
              : isSubmitting
                ? 'Updating…'
                : 'Update plan'}
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

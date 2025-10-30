import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  acceptInviteToken,
  declineInviteToken,
  listPendingInvites,
  type WorkspaceInvitation
} from '@/lib/orgWorkspaceApi'
import { useAuth } from '@/stores/auth'

type DecisionState = 'accepted' | 'declined' | null
type LoadingState = 'accept' | 'decline' | null

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return fallback
}

export default function PendingInviteModal() {
  const user = useAuth((state) => state.user)
  const isLoading = useAuth((state) => state.isLoading)
  const refreshMemberships = useAuth((state) => state.refreshMemberships)
  const setCurrentWorkspaceId = useAuth((state) => state.setCurrentWorkspaceId)

  const [queue, setQueue] = useState<WorkspaceInvitation[]>([])
  const [open, setOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<LoadingState>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [decision, setDecision] = useState<DecisionState>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  const fetchedUserRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const currentInvite = queue[0] ?? null
  const currentInviteId = currentInvite?.id ?? null

  useEffect(() => {
    setActionError(null)
    setFeedback(null)
    setDecision(null)
    setActionLoading(null)
  }, [currentInviteId])

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!user) {
      setQueue([])
      setOpen(false)
      fetchedUserRef.current = null
      return
    }

    const userId = user.id
    if (!userId) return

    if (fetchedUserRef.current === userId) {
      return
    }

    fetchedUserRef.current = userId
    let cancelled = false
    setIsFetching(true)

    const loadInvitations = async () => {
      try {
        const invites = await listPendingInvites()
        if (cancelled || !mountedRef.current) return
        const pending = invites.filter(
          (invite) => invite && invite.status === 'pending' && invite.token
        )
        setQueue(pending)
        setOpen(pending.length > 0)
      } catch (error) {
        if (cancelled || !mountedRef.current) return
        console.error('Failed to load pending invites', error)
        setQueue([])
        setOpen(false)
      } finally {
        if (!(cancelled || !mountedRef.current)) {
          setIsFetching(false)
        }
      }
    }

    loadInvitations()

    return () => {
      cancelled = true
    }
  }, [isLoading, user])

  useEffect(() => {
    if (queue.length === 0 && !isFetching) {
      setOpen(false)
    }
  }, [queue.length, isFetching])

  const workspaceLabel = useMemo(() => {
    if (!currentInvite) return ''
    const candidate = currentInvite.workspace_name?.trim()
    if (candidate) return candidate
    return currentInvite.workspace_id || ''
  }, [currentInvite])

  const formattedRole = useMemo(() => {
    if (!currentInvite?.role) return ''
    const normalized = currentInvite.role.toLowerCase()
    return normalized.charAt(0).toUpperCase() + normalized.slice(1)
  }, [currentInvite?.role])

  const handleAdvance = useCallback(() => {
    setQueue((previous) => previous.slice(1))
  }, [])

  const handleAccept = useCallback(async () => {
    if (!currentInvite) return
    setActionLoading('accept')
    setActionError(null)
    try {
      const result = await acceptInviteToken(currentInvite.token)
      const workspaceId =
        typeof result?.workspace_id === 'string' ? result.workspace_id : null

      try {
        await refreshMemberships()
      } catch (refreshError) {
        const refreshMessage = getErrorMessage(
          refreshError,
          'Failed to refresh memberships'
        )
        throw new Error(refreshMessage)
      }

      if (workspaceId) {
        setCurrentWorkspaceId(workspaceId)
      }

      setFeedback('Invite accepted')
      setDecision('accepted')
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to accept invitation')
      setActionError(message)
    } finally {
      setActionLoading(null)
    }
  }, [currentInvite, refreshMemberships, setCurrentWorkspaceId])

  const handleDecline = useCallback(async () => {
    if (!currentInvite) return
    setActionLoading('decline')
    setActionError(null)
    try {
      await declineInviteToken(currentInvite.token)
      setFeedback('Invite declined')
      setDecision('declined')
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to decline invitation')
      setActionError(message)
    } finally {
      setActionLoading(null)
    }
  }, [currentInvite])

  const handleContinue = handleAdvance

  if (!open || !currentInvite) {
    return null
  }

  const declineLoading = actionLoading === 'decline'
  const acceptLoading = actionLoading === 'accept'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Confirm workspace invitation
        </h2>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          You are about to join workspace
          <span className="font-medium"> {workspaceLabel}</span>
          {formattedRole && (
            <span>
              {' '}
              as <span className="font-medium">{formattedRole}</span>
            </span>
          )}
          .
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Invitation sent to {currentInvite.email}
        </p>
        {actionError && (
          <div className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-200">
            {actionError}
          </div>
        )}
        {feedback && (
          <div className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-600 dark:bg-emerald-950/40 dark:text-emerald-200">
            {feedback}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          {decision ? (
            <button
              type="button"
              onClick={handleContinue}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500"
            >
              Continue
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleDecline}
                disabled={declineLoading}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {declineLoading ? 'Declining…' : 'Decline'}
              </button>
              <button
                type="button"
                onClick={handleAccept}
                disabled={acceptLoading}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {acceptLoading ? 'Accepting…' : 'Accept'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

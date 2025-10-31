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
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}

export default function PendingInviteModal() {
  const user = useAuth((s) => s.user)
  const isLoading = useAuth((s) => s.isLoading)
  const refreshMemberships = useAuth((s) => s.refreshMemberships)
  const setCurrentWorkspaceId = useAuth((s) => s.setCurrentWorkspaceId)

  const [queue, setQueue] = useState<WorkspaceInvitation[]>([])
  const [actionLoading, setActionLoading] = useState<LoadingState>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [decision, setDecision] = useState<DecisionState>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const channelRef = useRef<BroadcastChannel | null>(null)
  const pollRef = useRef<number | null>(null)

  const currentInvite = queue[0] ?? null
  const currentInviteId = currentInvite?.id ?? null

  // reset UI when invite changes
  useEffect(() => {
    setActionError(null)
    setFeedback(null)
    setDecision(null)
    setActionLoading(null)
  }, [currentInviteId])

  // shared "pubsub" listener
  useEffect(() => {
    if (!channelRef.current) {
      channelRef.current = new BroadcastChannel('workspaceInvites')
      channelRef.current.onmessage = (event) => {
        if (event.data?.type === 'invitesUpdate') {
          const pending = event.data.invites.filter(
            (i: WorkspaceInvitation) =>
              i?.status?.toLowerCase() === 'pending' && i.token
          )
          setQueue(pending)
        }
      }
    }
    return () => channelRef.current?.close()
  }, [])

  // polling every 30s and broadcast updates
  useEffect(() => {
    if (!user || isLoading) return
    let cancelled = false

    const poll = async () => {
      try {
        const invites = await listPendingInvites()
        if (cancelled) return
        const pending = invites.filter(
          (i) => i?.status?.toLowerCase() === 'pending' && i.token
        )
        setQueue(pending)
        const ch = channelRef.current
        if (ch && !cancelled) ch.postMessage({ type: 'invitesUpdate', invites })
      } catch (err) {
        if (!cancelled) console.error('poll error', err)
      }
    }

    poll()
    pollRef.current = window.setInterval(poll, 30_000)

    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
      channelRef.current?.close()
      channelRef.current = null
    }
  }, [user, isLoading])

  const workspaceLabel = useMemo(() => {
    const n = currentInvite?.workspace_name?.trim()
    return n || currentInvite?.workspace_id || ''
  }, [currentInvite])

  const formattedRole = useMemo(() => {
    const r = currentInvite?.role
    return r ? r.charAt(0).toUpperCase() + r.slice(1).toLowerCase() : ''
  }, [currentInvite?.role])

  const handleAdvance = useCallback(() => {
    setQueue((prev) => prev.slice(1))
  }, [])

  const handleAccept = useCallback(async () => {
    if (!currentInvite) return
    setActionLoading('accept')
    setActionError(null)
    try {
      const result = await acceptInviteToken(currentInvite.token)
      const workspaceId =
        typeof result?.workspace_id === 'string' ? result.workspace_id : null
      await refreshMemberships()
      if (workspaceId) setCurrentWorkspaceId(workspaceId)
      setFeedback('Invite accepted')
      setDecision('accepted')
    } catch (err) {
      setActionError(getErrorMessage(err, 'Failed to accept invitation'))
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
    } catch (err) {
      setActionError(getErrorMessage(err, 'Failed to decline invitation'))
    } finally {
      setActionLoading(null)
    }
  }, [currentInvite])

  if (!currentInvite) return null

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
              onClick={handleAdvance}
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

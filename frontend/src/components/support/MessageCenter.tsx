import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  MailCheck,
  MailQuestion,
  MessageSquare,
  Reply
} from 'lucide-react'

import {
  IssueDetail,
  IssueThread,
  fetchIssueDetail,
  fetchIssueThreads,
  markIssueRead,
  replyToIssueThread
} from '@/lib/issuesApi'

type Props = {
  open: boolean
  onClose: () => void
  onUnreadChange?: (count: number) => void
}

export default function MessageCenter({
  open,
  onClose,
  onUnreadChange
}: Props) {
  const [threads, setThreads] = useState<IssueThread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<IssueDetail | null>(null)
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [replying, setReplying] = useState(false)

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId]
  )

  const refreshUnread = useCallback(
    (count: number) => {
      onUnreadChange?.(count)
    },
    [onUnreadChange]
  )

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true)
    setError(null)
    try {
      const response = await fetchIssueThreads()
      setThreads(response.issues)
      refreshUnread(response.unread_admin_messages)
      if (!selectedId && response.issues.length > 0) {
        setSelectedId(response.issues[0].id)
      } else if (
        selectedId &&
        !response.issues.some((issue) => issue.id === selectedId)
      ) {
        setSelectedId(response.issues[0]?.id ?? null)
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to load messages.'
      setError(message)
    } finally {
      setLoadingThreads(false)
    }
  }, [refreshUnread, selectedId])

  const loadDetail = useCallback(
    async (issueId: string | null) => {
      if (!issueId) {
        setDetail(null)
        setLoadingDetail(false)
        return
      }
      setLoadingDetail(true)
      setError(null)
      try {
        await markIssueRead(issueId)
        const data = await fetchIssueDetail(issueId)
        setDetail(data)
        refreshUnread(data.unread_admin_messages)
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === issueId
              ? {
                  ...thread,
                  unread_admin_messages: 0,
                  updated_at: data.issue.updated_at
                }
              : thread
          )
        )
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to load this conversation.'
        setError(message)
      } finally {
        setLoadingDetail(false)
      }
    },
    [refreshUnread]
  )

  useEffect(() => {
    if (open) {
      void loadThreads()
    } else {
      setSelectedId(null)
      setDetail(null)
      setReply('')
      setError(null)
    }
  }, [open, loadThreads])

  useEffect(() => {
    if (!open) return
    void loadDetail(selectedId)
  }, [open, selectedId, loadDetail])

  const handleReply = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (!selectedId || !reply.trim()) return
      setReplying(true)
      setError(null)
      try {
        const updated = await replyToIssueThread(selectedId, reply.trim())
        setDetail(updated)
        setReply('')
        refreshUnread(updated.unread_admin_messages)
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === selectedId
              ? {
                  ...thread,
                  last_message_body: reply.trim(),
                  last_message_sender: 'user',
                  unread_admin_messages: 0,
                  updated_at: updated.issue.updated_at
                }
              : thread
          )
        )
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to send your reply right now.'
        setError(message)
      } finally {
        setReplying(false)
      }
    },
    [selectedId, reply, refreshUnread]
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-[80vh] w-full max-w-5xl gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex w-64 flex-col gap-3 border-r border-zinc-200 pr-4 dark:border-zinc-700">
          <div className="flex items-center justify-between text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            <span className="flex items-center gap-2">
              <MessageSquare size={16} />
              Messages
            </span>
            {loadingThreads ? (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
            ) : (
              <button
                type="button"
                onClick={() => void loadThreads()}
                className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
              >
                Refresh
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            {threads.length === 0 ? (
              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-sm text-zinc-500">
                No messages yet. We will post replies from DSentr here.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {threads.map((thread) => {
                  const isActive = thread.id === selectedId
                  const hasUnread = thread.unread_admin_messages > 0
                  return (
                    <li
                      key={thread.id}
                      className={`cursor-pointer px-3 py-3 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        isActive ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                      }`}
                      onClick={() => setSelectedId(thread.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {thread.workspace_name || 'Personal workspace'}
                        </div>
                        {hasUnread ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-200">
                            <span className="h-2 w-2 rounded-full bg-red-500" />
                            {thread.unread_admin_messages}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {thread.last_message_body
                          ? thread.last_message_body.slice(0, 80)
                          : 'View conversation'}
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-400">
                        Updated {new Date(thread.updated_at).toLocaleString()}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Conversation
              </div>
              <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {detail?.issue.id ?? selectedThread?.id ?? 'Messages'}
              </div>
              {detail?.workspace_name ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Workspace: {detail.workspace_name}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={onClose}
            >
              Close
            </button>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/30 dark:text-red-100">
              {error}
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
            {loadingDetail ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading conversation...
              </div>
            ) : detail ? (
              <div className="space-y-3">
                {detail.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      msg.sender_type === 'admin'
                        ? 'border-indigo-200 bg-white shadow-sm dark:border-indigo-800 dark:bg-indigo-900/30'
                        : 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide">
                        {msg.sender_type === 'admin' ? (
                          <>
                            <MailCheck size={12} />
                            DSentr
                          </>
                        ) : (
                          <>
                            <Reply size={12} />
                            You
                          </>
                        )}
                      </span>
                      <span>{new Date(msg.created_at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 text-zinc-900 dark:text-zinc-50">
                      {msg.body}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <MailQuestion size={14} />
                Select a conversation to view messages.
              </div>
            )}
          </div>

          <form className="space-y-2" onSubmit={handleReply}>
            <label className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              Reply
              <textarea
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-75 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/40"
                rows={3}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                disabled={!detail || replying}
                placeholder="Send a message back to DSentr support"
              />
            </label>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                Unread messages from DSentr:{' '}
                {detail?.unread_admin_messages ?? 0}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => void loadDetail(selectedId)}
                  disabled={!selectedId || loadingDetail}
                >
                  Mark as read
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                  disabled={!detail || replying || !reply.trim()}
                >
                  {replying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Reply className="h-4 w-4" />
                      Send reply
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

import { MessageSquare } from 'lucide-react'

type Props = {
  onOpen: () => void
  unreadCount?: number
}

export default function MessagesButton({ onOpen, unreadCount = 0 }: Props) {
  const hasUnread = (unreadCount ?? 0) > 0
  const badgeLabel =
    unreadCount && unreadCount > 99 ? '99+' : unreadCount?.toString()

  return (
    <button
      type="button"
      aria-label="Messages"
      title="Messages"
      className="relative rounded p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700"
      onClick={onOpen}
    >
      <MessageSquare size={18} />
      {hasUnread ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm">
          {badgeLabel}
        </span>
      ) : null}
    </button>
  )
}

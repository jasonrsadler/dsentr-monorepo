import { UserRound } from 'lucide-react'

type Props = {
  onOpenProfile: () => void
}

export default function ProfileButton({ onOpenProfile }: Props) {
  return (
    <button
      type="button"
      aria-label="Open profile"
      className="p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
      onClick={onOpenProfile}
    >
      <UserRound size={18} />
    </button>
  )
}

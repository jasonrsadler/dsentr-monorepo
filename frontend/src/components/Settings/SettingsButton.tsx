import { Settings } from 'lucide-react'

type Props = {
  onOpenSettings: () => void
}

export default function SettingsButton({ onOpenSettings }: Props) {
  return (
    <button
      aria-label="Open settings"
      className="p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
      onClick={onOpenSettings}
    >
      <Settings size={18} />
    </button>
  )
}

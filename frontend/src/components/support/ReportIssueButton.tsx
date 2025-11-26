import { Bug } from 'lucide-react'

type Props = {
  onOpen: () => void
}

export default function ReportIssueButton({ onOpen }: Props) {
  return (
    <button
      type="button"
      aria-label="Report an issue"
      title="Report an issue"
      className="p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
      onClick={onOpen}
    >
      <Bug size={18} />
    </button>
  )
}

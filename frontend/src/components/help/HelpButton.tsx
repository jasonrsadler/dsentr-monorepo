import { HelpCircle } from 'lucide-react'

export default function HelpButton() {
  return (
    <button
      type="button"
      aria-label="Open docs"
      title="Documentation"
      className="p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
      onClick={() => window.open('https://docs.dsentr.com', '_blank')}
    >
      <HelpCircle size={18} />
    </button>
  )
}

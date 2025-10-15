import { useState } from 'react'

const actionTypes = [
  { id: 'email', label: 'Send Email' },
  { id: 'webhook', label: 'POST Webhook' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'sheets', label: 'Create Google Sheet Row' },
  { id: 'http', label: 'HTTP Request' },
  { id: 'code', label: 'Run Custom Code' }
]

export default function ActionTypeDropdown({
  value,
  onChange,
  disabledOptions = {},
  onBlockedSelect
}: {
  value: string
  onChange: (value: string) => void
  disabledOptions?: Record<string, string>
  onBlockedSelect?: (id: string, reason?: string) => void
}) {
  const [open, setOpen] = useState(false)

  const selectedLabel =
    actionTypes.find((a) => a.id === value)?.label || 'Select Action'

  const handleSelect = (id) => {
    if (disabledOptions[id]) {
      onBlockedSelect?.(id, disabledOptions[id])
      return
    }
    onChange(id)
    setOpen(false)
  }

  return (
    <div className="relative inline-block w-full text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative w-full text-left px-2 py-1 border rounded bg-zinc-50 dark:bg-zinc-800"
      >
        {selectedLabel}
        <svg
          className={`absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <ul className="absolute z-10 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-48 overflow-auto">
          {actionTypes.map((action) => (
            <li
              key={action.id}
              onClick={() => handleSelect(action.id)}
              className={`px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
                disabledOptions[action.id]
                  ? 'opacity-60 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent'
                  : ''
              }`}
              aria-disabled={Boolean(disabledOptions[action.id])}
              title={disabledOptions[action.id] ?? undefined}
            >
              {action.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

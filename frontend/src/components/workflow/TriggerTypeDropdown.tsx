import { useMemo, useState } from 'react'

type TriggerOption = {
  label: string
  value: string
}

const triggerOptions: TriggerOption[] = [
  { label: 'Manual', value: 'Manual' },
  { label: 'Webhook', value: 'Webhook' },
  { label: 'Schedule', value: 'Schedule' }
]

export default function TriggerTypeDropdown({
  value,
  onChange,
  disabledOptions = {},
  onBlockedSelect
}: {
  value: string
  onChange: (value: string) => void
  disabledOptions?: Record<string, string>
  onBlockedSelect?: (value: string, reason?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedLabel = useMemo(() => {
    const match = triggerOptions.find((option) => option.value === value)
    return match?.label || value
  }, [value])

  const handleSelect = (type: string) => {
    if (disabledOptions[type]) {
      onBlockedSelect?.(type, disabledOptions[type])
      return
    }
    onChange(type)
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
          className={`absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
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
        <ul className="absolute z-10 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-32 overflow-auto themed-scroll">
          {triggerOptions.map((option) => (
            <li
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className={`px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
                disabledOptions[option.value]
                  ? 'opacity-60 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent'
                  : ''
              }`}
              aria-disabled={Boolean(disabledOptions[option.value])}
              title={disabledOptions[option.value] ?? undefined}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

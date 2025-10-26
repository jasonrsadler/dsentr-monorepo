import { useMemo, useState } from 'react'

interface SESVersionDropdownProps {
  value: string
  onChange: (value: string) => void
}

const versions = [
  { value: 'v1', label: 'SES v1 (Classic)' },
  { value: 'v2', label: 'SES v2 (API)' }
]

export default function SESVersionDropdown({
  value,
  onChange
}: SESVersionDropdownProps) {
  const [open, setOpen] = useState(false)

  const selectedLabel = useMemo(() => {
    const match = versions.find((v) => v.value === value)
    return match?.label ?? 'Select Version'
  }, [value])

  const handleSelect = (version: string) => {
    onChange(version)
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
        <ul className="absolute z-10 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-40 overflow-auto themed-scroll">
          {versions.map((version) => (
            <li
              key={version.value}
              onClick={() => handleSelect(version.value)}
              className="px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              {version.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

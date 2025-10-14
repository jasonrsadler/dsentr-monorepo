import { useState } from 'react'

interface NodeDropdownFieldProps {
  options: string[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export default function NodeDropdownField({
  options,
  value,
  onChange,
  placeholder = 'Select Region',
  disabled = false
}: NodeDropdownFieldProps) {
  const [open, setOpen] = useState(false)

  const handleSelect = (option: string) => {
    onChange(option)
    setOpen(false)
  }

  const toggleOpen = () => {
    if (disabled || options.length === 0) return
    setOpen((prev) => !prev)
  }

  const displayLabel = value || placeholder

  return (
    <div className="relative inline-block w-full text-xs">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className={`relative w-full text-left px-2 py-1 border rounded bg-zinc-50 dark:bg-zinc-800 ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        {displayLabel}
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
        <ul className="absolute z-10 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-32 overflow-auto">
          {options.map((region) => (
            <li
              key={region}
              onClick={() => handleSelect(region)}
              className="px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              {region}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

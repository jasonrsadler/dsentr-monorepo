import { useState } from 'react'

const triggerTypes = ['Manual', 'Webhook', 'Schedule']

export default function TriggerTypeDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)

  const handleSelect = (type) => {
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
        {value}
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
        <ul className="absolute z-10 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-32 overflow-auto">
          {triggerTypes.map((type) => (
            <li
              key={type}
              onClick={() => handleSelect(type)}
              className="px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              {type}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

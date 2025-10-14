import { useMemo, useState } from 'react'

type DropdownOption =
  | string
  | {
      label: string
      value: string
      disabled?: boolean
    }

interface NodeDropdownFieldProps {
  options: DropdownOption[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  emptyMessage?: string
}

export default function NodeDropdownField({
  options,
  value,
  onChange,
  placeholder = 'Select Region',
  disabled = false,
  loading = false,
  emptyMessage = 'No options available'
}: NodeDropdownFieldProps) {
  const [open, setOpen] = useState(false)

  const normalizedOptions = useMemo(
    () =>
      options.map((option) =>
        typeof option === 'string'
          ? { label: option, value: option, disabled: false }
          : {
              label: option.label,
              value: option.value,
              disabled: option.disabled ?? false
            }
      ),
    [options]
  )
  const selected = useMemo(
    () => normalizedOptions.find((option) => option.value === value),
    [normalizedOptions, value]
  )
  const buttonLabel = loading
    ? 'Loading…'
    : selected?.label || value || placeholder
  const toggleOpen = () => {
    if (disabled || loading) return
    setOpen((prev) => !prev)
  }

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
  }

  return (
    <div className="relative inline-block w-full text-xs">
      <button
        type="button"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
        className={`relative w-full text-left px-2 py-1 border rounded bg-zinc-50 dark:bg-zinc-800 transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${open ? 'ring-1 ring-blue-500 border-blue-400 dark:border-blue-500' : ''}`}
      >
        {buttonLabel}
        <svg
          className={`absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-10 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-40 overflow-auto"
        >
          {loading ? (
            <li className="px-2 py-2 text-zinc-500 dark:text-zinc-400">
              Loading…
            </li>
          ) : normalizedOptions.length === 0 ? (
            <li className="px-2 py-2 text-zinc-500 dark:text-zinc-400">
              {emptyMessage}
            </li>
          ) : (
            normalizedOptions.map((option) => (
              <li
                role="option"
                key={option.value}
                aria-selected={option.value === value}
                onClick={() => {
                  if (option.disabled) return
                  handleSelect(option.value)
                }}
                className={`px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
                  option.disabled
                    ? 'cursor-not-allowed opacity-50 hover:bg-transparent'
                    : ''
                }`}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

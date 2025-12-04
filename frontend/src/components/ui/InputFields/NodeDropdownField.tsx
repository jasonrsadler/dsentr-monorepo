import { useEffect, useMemo, useState } from 'react'

export type NodeDropdownOption =
  | string
  | {
      label: string
      value: string
      disabled?: boolean
    }

export interface NodeDropdownOptionGroup {
  label: string
  options: NodeDropdownOption[]
}

type DropdownEntry = NodeDropdownOption | NodeDropdownOptionGroup

type NormalizedItem =
  | {
      type: 'group'
      label: string
    }
  | {
      type: 'option'
      label: string
      value: string
      disabled: boolean
    }

interface NodeDropdownFieldProps {
  options: DropdownEntry[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  emptyMessage?: string
  onOptionBlocked?: (value: string) => void
  onButtonClick?: () => void
  collapsibleGroups?: boolean
}

export default function NodeDropdownField({
  options,
  value,
  onChange,
  placeholder = 'Select Region',
  disabled = false,
  loading = false,
  emptyMessage = 'No options available',
  onOptionBlocked,
  onButtonClick,
  collapsibleGroups = false
}: NodeDropdownFieldProps) {
  const [open, setOpen] = useState(false)
  const hasGroups = useMemo(
    () =>
      options.some(
        (entry) =>
          typeof entry === 'object' && entry !== null && 'options' in entry
      ),
    [options]
  )

  const normalizedItems = useMemo<NormalizedItem[]>(() => {
    const items: NormalizedItem[] = []

    const normalizeOption = (option: NodeDropdownOption) => {
      if (typeof option === 'string') {
        items.push({
          type: 'option',
          label: option,
          value: option,
          disabled: false
        })
        return
      }

      items.push({
        type: 'option',
        label: option.label,
        value: option.value,
        disabled: option.disabled ?? false
      })
    }

    options.forEach((entry) => {
      if (typeof entry === 'object' && entry !== null && 'options' in entry) {
        items.push({ type: 'group', label: entry.label })
        entry.options.forEach((option) => normalizeOption(option))
      } else {
        normalizeOption(entry as NodeDropdownOption)
      }
    })

    return items
  }, [options])

  const groupedOptions = useMemo(() => {
    const groups: NodeDropdownOptionGroup[] = []
    options.forEach((entry) => {
      if (typeof entry === 'object' && entry !== null && 'options' in entry) {
        groups.push({
          label: entry.label,
          options: entry.options
        })
      } else {
        groups.push({
          label: '',
          options: [entry as NodeDropdownOption]
        })
      }
    })
    return groups
  }, [options])

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!hasGroups) return
    const defaults = Object.fromEntries(
      groupedOptions.map((group, index) => [
        group.label || `group-${index}`,
        true
      ])
    )
    setOpenGroups((prev) => ({ ...defaults, ...prev }))
  }, [groupedOptions, hasGroups])

  const selectableOptions = useMemo(
    () =>
      normalizedItems.filter(
        (item): item is Extract<NormalizedItem, { type: 'option' }> =>
          item.type === 'option'
      ),
    [normalizedItems]
  )

  const selected = useMemo(
    () => selectableOptions.find((option) => option.value === value),
    [selectableOptions, value]
  )
  const buttonLabel = loading
    ? 'Loading...'
    : selected?.label || value || placeholder
  const toggleOpen = () => {
    if (disabled || loading) return
    onButtonClick?.()
    setOpen((prev) => !prev)
  }

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
  }

  const hasOptions = selectableOptions.length > 0

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
          className="absolute z-10 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-40 overflow-auto themed-scroll"
        >
          {loading ? (
            <li className="px-2 py-2 text-zinc-500 dark:text-zinc-400">
              Loading...
            </li>
          ) : !hasOptions ? (
            <li className="px-2 py-2 text-zinc-500 dark:text-zinc-400">
              {emptyMessage}
            </li>
          ) : collapsibleGroups && hasGroups ? (
            groupedOptions.map((group, groupIndex) => {
              const label = group.label || 'Options'
              const stateKey = group.label || `group-${groupIndex}`
              const isOpen = openGroups[stateKey] ?? true
              const normalizedGroupOptions = group.options.map((option) =>
                typeof option === 'string'
                  ? { label: option, value: option, disabled: false }
                  : {
                      label: option.label,
                      value: option.value,
                      disabled: option.disabled ?? false
                    }
              )
              return (
                <li
                  key={`${label}-${groupIndex}`}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenGroups((prev) => ({
                        ...prev,
                        [stateKey]: !(prev[stateKey] ?? true)
                      }))
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-sm bg-zinc-300 dark:bg-zinc-600 ${isOpen ? '' : ''}`}
                        aria-hidden
                      />
                      {label}
                    </span>
                    <svg
                      className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 5l8 7-8 7"
                      />
                    </svg>
                  </button>
                  {isOpen ? (
                    <ul className="pb-1">
                      {normalizedGroupOptions.map((item) => (
                        <li
                          role="option"
                          key={item.value}
                          aria-selected={item.value === value}
                          onClick={() => {
                            if (item.disabled) {
                              onOptionBlocked?.(item.value)
                              return
                            }
                            handleSelect(item.value)
                          }}
                          className={`px-4 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
                            item.disabled
                              ? 'cursor-not-allowed opacity-50 hover:bg-transparent'
                              : ''
                          }`}
                        >
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })
          ) : (
            normalizedItems.map((item, index) => {
              if (item.type === 'group') {
                return (
                  <li
                    key={`group-${index}-${item.label}`}
                    className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                  >
                    {item.label}
                  </li>
                )
              }

              return (
                <li
                  role="option"
                  key={item.value}
                  aria-selected={item.value === value}
                  onClick={() => {
                    if (item.disabled) {
                      onOptionBlocked?.(item.value)
                      return
                    }
                    handleSelect(item.value)
                  }}
                  className={`px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
                    item.disabled
                      ? 'cursor-not-allowed opacity-50 hover:bg-transparent'
                      : ''
                  }`}
                >
                  {item.label}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}

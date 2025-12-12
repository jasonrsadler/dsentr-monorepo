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
  searchable?: boolean
  searchPlaceholder?: string
  searchThreshold?: number
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
  collapsibleGroups = false,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchThreshold = 7
}: NodeDropdownFieldProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const hasGroups = useMemo(
    () =>
      options.some(
        (entry) =>
          typeof entry === 'object' && entry !== null && 'options' in entry
      ),
    [options]
  )

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

  const normalizedGroups = useMemo(
    () =>
      groupedOptions.map((group, index) => ({
        label: group.label,
        key: group.label || `group-${index}`,
        options: group.options.map((option) =>
          typeof option === 'string'
            ? { label: option, value: option, disabled: false }
            : {
                label: option.label,
                value: option.value,
                disabled: option.disabled ?? false
              }
        )
      })),
    [groupedOptions]
  )

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const defaultOpenMap = useMemo(() => {
    if (!hasGroups) return {}
    return Object.fromEntries(normalizedGroups.map((g) => [g.key, true]))
  }, [hasGroups, normalizedGroups])

  useEffect(() => {
    if (!hasGroups) return
    setOpenGroups((prev) => ({ ...defaultOpenMap, ...prev }))
  }, [hasGroups, defaultOpenMap])

  const selectableOptions = useMemo(
    () => normalizedGroups.flatMap((group) => group.options),
    [normalizedGroups]
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

  useEffect(() => {
    if (!open) {
      setSearchTerm('')
    }
  }, [open])

  const shouldShowSearch =
    searchable && selectableOptions.length > (searchThreshold ?? 0)

  const filteredGroups = useMemo(() => {
    if (!shouldShowSearch) return normalizedGroups
    const needle = searchTerm.trim().toLowerCase()
    if (!needle) return normalizedGroups
    return normalizedGroups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) =>
          option.label.toLowerCase().includes(needle)
        )
      }))
      .filter((group) => group.options.length > 0)
  }, [normalizedGroups, searchTerm, shouldShowSearch])

  const displayedItems = useMemo(() => {
    if (hasGroups) {
      const items: NormalizedItem[] = []
      filteredGroups.forEach((group) => {
        if (group.label) {
          items.push({ type: 'group', label: group.label })
        }
        group.options.forEach((option) =>
          items.push({
            type: 'option',
            label: option.label,
            value: option.value,
            disabled: option.disabled
          })
        )
      })
      return items
    }

    return filteredGroups.flatMap<NormalizedItem>((group) =>
      group.options.map((option) => ({
        type: 'option',
        label: option.label,
        value: option.value,
        disabled: option.disabled
      }))
    )
  }, [filteredGroups, hasGroups])

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
  }

  const hasOptions = displayedItems.some((item) => item.type === 'option')

  return (
    <div className="relative inline-block w-full text-xs">
      <button
        type="button"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
        className={`relative w-full rounded border px-2 py-1 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${open ? 'ring-1 ring-blue-500 border-blue-400 dark:border-blue-500' : ''} bg-zinc-50 dark:bg-zinc-800`}
      >
        {buttonLabel}
        <svg
          className={`absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 transition-transform ${open ? 'rotate-180' : ''}`}
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
        <div className="absolute z-10 mt-1 w-full rounded border bg-white shadow-md dark:border-zinc-800 dark:bg-zinc-900">
          {shouldShowSearch ? (
            <div className="p-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
          ) : null}
          <ul
            role="listbox"
            className="max-h-40 overflow-auto border-t border-zinc-100 px-0 py-0 themed-scroll dark:border-zinc-800"
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
              filteredGroups.map((group, groupIndex) => {
                const label = group.label || 'Options'
                const stateKey = group.label || `group-${groupIndex}`
                const hasSearch = searchTerm.trim().length > 0
                const isOpen = hasSearch ? true : (openGroups[stateKey] ?? true)
                return (
                  <li
                    key={`${label}-${groupIndex}`}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setOpenGroups((prev) => ({
                          ...prev,
                          [stateKey]: hasSearch
                            ? true
                            : !(prev[stateKey] ?? true)
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
                        {group.options.map((item) => (
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
                            className={`cursor-pointer px-4 py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
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
              displayedItems.map((item, index) => {
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
                    className={`cursor-pointer px-2 py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
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
        </div>
      )}
    </div>
  )
}

import { Search } from 'lucide-react'

type ScheduleTimezonePickerProps = {
  options: string[]
  selectedTimezone?: string
  search: string
  onSearchChange: (value: string) => void
  onSelect: (timezone: string) => void
}

export function ScheduleTimezonePicker({
  options,
  selectedTimezone,
  search,
  onSearchChange,
  onSelect
}: ScheduleTimezonePickerProps) {
  return (
    <div className="w-full min-w-[18rem] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 sm:w-[22rem]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search timezones"
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-3 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-100"
        />
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-zinc-200/60 bg-white dark:border-zinc-700/60 dark:bg-zinc-950/40">
        {options.length > 0 ? (
          options.map((timezone) => {
            const isSelected = selectedTimezone === timezone
            return (
              <button
                key={timezone}
                type="button"
                onClick={() => onSelect(timezone)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                  isSelected
                    ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-200'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <span className="truncate">{timezone}</span>
                {isSelected && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-300">
                    Selected
                  </span>
                )}
              </button>
            )
          })
        ) : (
          <p className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">No matches found.</p>
        )}
      </div>
    </div>
  )
}

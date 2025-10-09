import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  CalendarMonth,
  weekdayLabels,
  buildCalendarGrid,
  normalizeCalendarMonth,
  toISODateString
} from './utils'

type ScheduleCalendarProps = {
  month: CalendarMonth
  selectedDate?: string
  todayISO?: string
  onMonthChange: (month: CalendarMonth) => void
  onSelectDate: (isoDate: string) => void
}

export function ScheduleCalendar({
  month,
  selectedDate,
  todayISO,
  onMonthChange,
  onSelectDate
}: ScheduleCalendarProps) {
  const calendarCells = useMemo(() => buildCalendarGrid(month), [month])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        <button
          type="button"
          onClick={() => onMonthChange(normalizeCalendarMonth(month.month - 1, month.year))}
          className="rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span>
          {new Intl.DateTimeFormat(undefined, {
            month: 'long',
            year: 'numeric'
          }).format(new Date(month.year, month.month, 1))}
        </span>
        <button
          type="button"
          onClick={() => onMonthChange(normalizeCalendarMonth(month.month + 1, month.year))}
          className="rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {weekdayLabels.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1 text-sm">
        {calendarCells.map((cell) => {
          const isoDate = toISODateString(cell.date.year, cell.date.month, cell.date.day)
          const isSelected = selectedDate === isoDate
          const isToday = todayISO === isoDate
          return (
            <button
              key={`${cell.date.year}-${cell.date.month}-${cell.date.day}`}
              type="button"
              onClick={() => onSelectDate(isoDate)}
              className={`h-10 rounded-lg border text-center transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                isSelected
                  ? 'border-blue-500 bg-blue-500 text-white shadow'
                  : cell.inCurrentMonth
                  ? 'border-transparent text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  : 'border-transparent text-zinc-400 hover:bg-zinc-100/70 dark:text-zinc-600 dark:hover:bg-zinc-800/60'
              }`}
            >
              <span className="inline-flex h-full w-full items-center justify-center">
                {cell.day}
                {isToday && !isSelected && (
                  <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden="true" />
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

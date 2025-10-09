export type CalendarMonth = {
  year: number
  month: number // 0-based
}

export const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const hoursList = Array.from({ length: 24 }, (_, index) => index)
export const minutesList = Array.from({ length: 60 }, (_, index) => index)

export function normalizeCalendarMonth(
  month: number,
  year: number
): CalendarMonth {
  const normalized = new Date(Date.UTC(year, month, 1))
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth()
  }
}

export function parseISODate(value?: string | null) {
  if (!value) return undefined
  const [year, month, day] = value
    .split('-')
    .map((part) => Number.parseInt(part, 10))
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined
  }
  return { year, month: month - 1, day }
}

export function toISODateString(year: number, month: number, day: number) {
  return [
    year.toString().padStart(4, '0'),
    (month + 1).toString().padStart(2, '0'),
    day.toString().padStart(2, '0')
  ].join('-')
}

export function getInitialMonth(date?: string) {
  const parsed = parseISODate(date)
  if (parsed) {
    return normalizeCalendarMonth(parsed.month, parsed.year)
  }
  const today = new Date()
  return {
    year: today.getFullYear(),
    month: today.getMonth()
  }
}

export function buildCalendarGrid({ year, month }: CalendarMonth) {
  const firstDay = new Date(Date.UTC(year, month, 1))
  const firstWeekday = firstDay.getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate()

  const cells: Array<{
    day: number
    date: CalendarMonth & { day: number }
    inCurrentMonth: boolean
  }> = []

  for (let index = 0; index < 42; index += 1) {
    if (index < firstWeekday) {
      const day = prevMonthDays - firstWeekday + index + 1
      const prev = normalizeCalendarMonth(month - 1, year)
      cells.push({
        day,
        date: { ...prev, day },
        inCurrentMonth: false
      })
      continue
    }

    const currentDay = index - firstWeekday + 1
    if (currentDay <= daysInMonth) {
      cells.push({
        day: currentDay,
        date: { year, month, day: currentDay },
        inCurrentMonth: true
      })
      continue
    }

    const nextDay = currentDay - daysInMonth
    const next = normalizeCalendarMonth(month + 1, year)
    cells.push({
      day: nextDay,
      date: { ...next, day: nextDay },
      inCurrentMonth: false
    })
  }

  return cells
}

export function formatDisplayDate(value: string | undefined) {
  const parsed = parseISODate(value)
  if (!parsed) return 'Select date'
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
  const date = new Date(parsed.year, parsed.month, parsed.day)
  return formatter.format(date)
}

export function parseTime(value?: string | null) {
  if (!value) return undefined
  const [hours, minutes] = value
    .split(':')
    .map((part) => Number.parseInt(part, 10))
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return undefined
  }
  return { hours, minutes }
}

export function toTimeString(hours: number, minutes: number) {
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

export function formatDisplayTime(value: string | undefined) {
  const parsed = parseTime(value)
  if (!parsed) return 'Select time'
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  })
  const date = new Date(1970, 0, 1, parsed.hours, parsed.minutes)
  return formatter.format(date)
}

export type TimeParts = ReturnType<typeof parseTime>

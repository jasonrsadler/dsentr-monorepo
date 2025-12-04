import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, Clock, Globe2 } from 'lucide-react'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import NodeDropdownField from '@/components/ui/InputFields/NodeDropdownField'
import { ScheduleCalendar } from '@/components/ui/schedule/ScheduleCalendar'
import { ScheduleTimePicker } from '@/components/ui/schedule/ScheduleTimePicker'
import {
  toISODateString,
  getInitialMonth,
  formatDisplayDate,
  formatDisplayTime,
  parseTime,
  type CalendarMonth
} from '@/components/ui/schedule/utils'
import { ScheduleTimezonePicker } from '@/components/ui/schedule/ScheduleTimezonePicker'
import {
  normalizeDelayConfig,
  validateDelayConfig,
  type DelayConfig,
  type DurationConfig
} from './helpers'

const labels = {
  duration: 'Wait for duration',
  waitUntil: 'Wait until a specific datetime',
  jitter: 'Jitter (seconds)'
} as const

interface DelayNodeConfigProps {
  config: DelayConfig
  onChange: (config: DelayConfig) => void
  hasValidationErrors?: boolean
  canEdit?: boolean
}

const toFieldValue = (val?: number) =>
  typeof val === 'number' && Number.isFinite(val) ? String(val) : ''

type DateTimeParts = {
  date: string
  hour: number
  minute: number
  second: number
  valid: boolean
}

const parseWaitUntil = (waitUntil: string): DateTimeParts => {
  if (!waitUntil) {
    return { date: '', hour: 0, minute: 0, second: 0, valid: false }
  }
  const dt = new Date(waitUntil)
  if (Number.isNaN(dt.getTime())) {
    return { date: '', hour: 0, minute: 0, second: 0, valid: false }
  }
  return {
    date: dt.toISOString().slice(0, 10),
    hour: dt.getUTCHours(),
    minute: dt.getUTCMinutes(),
    second: dt.getUTCSeconds(),
    valid: true
  }
}

const buildIso = (
  dateStr: string,
  hour: number,
  minute: number,
  second: number,
  timezone?: string
) => {
  if (!dateStr) return undefined
  const [yearStr, monthStr, dayStr] = dateStr.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return undefined
  }
  const baseUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (Number.isNaN(baseUtc.getTime())) {
    return undefined
  }
  if (!timezone || timezone === 'UTC') {
    return baseUtc.toISOString()
  }
  try {
    const zoned = new Date(
      baseUtc.toLocaleString('en-US', { timeZone: timezone })
    )
    const diff = baseUtc.getTime() - zoned.getTime()
    const adjusted = new Date(baseUtc.getTime() - diff)
    if (Number.isNaN(adjusted.getTime())) {
      return undefined
    }
    return adjusted.toISOString()
  } catch {
    return baseUtc.toISOString()
  }
}

export default function DelayNodeConfig({
  config,
  onChange,
  hasValidationErrors,
  canEdit = true
}: DelayNodeConfigProps) {
  const normalizedConfig = useMemo(() => normalizeDelayConfig(config), [config])

  const mode = normalizedConfig.mode ?? 'duration'
  const waitFor = useMemo(
    () => normalizedConfig.wait_for ?? {},
    [normalizedConfig.wait_for]
  )
  const waitUntil = normalizedConfig.wait_until ?? ''
  const jitter = normalizedConfig.jitter_seconds

  const emitConfig = useCallback(
    (next: DelayConfig) => {
      if (!canEdit) return
      onChange(normalizeDelayConfig(next))
    },
    [canEdit, onChange]
  )

  const handleDurationChange = useCallback(
    (key: keyof DurationConfig, value: string) => {
      const nextWaitFor: DurationConfig = {
        ...waitFor,
        [key]: value
      }
      emitConfig({
        ...normalizedConfig,
        wait_for: nextWaitFor
      })
    },
    [emitConfig, normalizedConfig, waitFor]
  )

  const updateWaitUntil = useCallback(
    (
      dateStr: string,
      hour: number,
      minute: number,
      second: number,
      timezone?: string
    ) => {
      const iso = buildIso(dateStr, hour, minute, second, timezone)
      emitConfig({
        ...normalizedConfig,
        wait_until: iso
      })
    },
    [emitConfig, normalizedConfig]
  )

  const handleJitterChange = useCallback(
    (value: string) => {
      emitConfig({
        ...normalizedConfig,
        jitter_seconds: value as unknown as number
      })
    },
    [emitConfig, normalizedConfig]
  )

  const derivedHasErrors = useMemo(
    () => validateDelayConfig(normalizedConfig),
    [normalizedConfig]
  )

  const showErrors =
    (hasValidationErrors ?? derivedHasErrors) || derivedHasErrors

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Mode
        </label>
        <NodeDropdownField
          value={mode}
          onChange={(val) => {
            const nextMode =
              val === 'datetime' || val === 'duration' ? val : 'duration'
            emitConfig({
              ...normalizedConfig,
              mode: nextMode,
              wait_for:
                nextMode === 'duration'
                  ? normalizedConfig.wait_for
                  : { minutes: undefined, hours: undefined, days: undefined },
              wait_until:
                nextMode === 'datetime'
                  ? normalizedConfig.wait_until
                  : undefined
            })
          }}
          options={[
            { label: 'Wait for duration', value: 'duration' },
            { label: 'Wait until specific datetime', value: 'datetime' }
          ]}
        />
      </div>

      {mode === 'duration' ? (
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {labels.duration}
          </label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <span className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Days
              </span>
              <NodeInputField
                type="number"
                value={toFieldValue(waitFor.days)}
                onChange={(val) => handleDurationChange('days', val)}
                placeholder="0"
              />
            </div>
            <div>
              <span className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Hours
              </span>
              <NodeInputField
                type="number"
                value={toFieldValue(waitFor.hours)}
                onChange={(val) => handleDurationChange('hours', val)}
                placeholder="0"
              />
            </div>
            <div>
              <span className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Minutes
              </span>
              <NodeInputField
                type="number"
                value={toFieldValue(waitFor.minutes)}
                onChange={(val) => handleDurationChange('minutes', val)}
                placeholder="0"
              />
            </div>
          </div>
        </div>
      ) : null}

      {mode === 'datetime' ? (
        <DateTimeFields waitUntil={waitUntil} onChange={updateWaitUntil} />
      ) : null}

      <div className="space-y-1">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {labels.jitter}
        </label>
        <NodeInputField
          type="number"
          placeholder="0"
          value={toFieldValue(jitter)}
          onChange={handleJitterChange}
        />
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Adds a random offset between 0 and the provided seconds to prevent
          thundering herd retries.
        </p>
      </div>

      {showErrors ? (
        <p className="text-xs text-red-500">
          Configure a duration or an absolute time to continue.
        </p>
      ) : null}
    </div>
  )
}

function DateTimeFields({
  waitUntil,
  onChange
}: {
  waitUntil: string
  onChange: (
    date: string,
    hour: number,
    minute: number,
    second: number,
    timezone?: string
  ) => void
}) {
  const parts = useMemo(() => parseWaitUntil(waitUntil), [waitUntil])
  const [timePickerOpen, setTimePickerOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [timezonePickerOpen, setTimezonePickerOpen] = useState(false)
  const [timezoneSearch, setTimezoneSearch] = useState('')
  const defaultTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }, [])
  const [timezone, setTimezone] = useState<string>(defaultTimezone)
  const fallbackDate = useMemo(() => {
    const today = new Date()
    return toISODateString(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate()
    )
  }, [])
  const initialDate = parts.date || fallbackDate
  const [month, setMonth] = useState<CalendarMonth>(() =>
    getInitialMonth(initialDate)
  )
  const selectedTimeString = useMemo(() => {
    const hours = parts.hour.toString().padStart(2, '0')
    const minutes = parts.minute.toString().padStart(2, '0')
    return `${hours}:${minutes}`
  }, [parts.hour, parts.minute])
  const selectedTimeParts = useMemo(
    () => parseTime(selectedTimeString),
    [selectedTimeString]
  )
  const timezoneOptions = useMemo(() => {
    const options: string[] = []
    try {
      const maybeSupported = (Intl as any).supportedValuesOf
      if (typeof maybeSupported === 'function') {
        const supported = maybeSupported('timeZone')
        if (Array.isArray(supported)) {
          options.push(...supported)
        }
      }
    } catch {
      /* ignore */
    }
    options.push(timezone)
    options.push('UTC')
    return Array.from(new Set(options))
  }, [timezone])

  const filteredTimezones = useMemo(() => {
    const needle = timezoneSearch.trim().toLowerCase()
    if (!needle) return timezoneOptions
    return timezoneOptions.filter((tz) => tz.toLowerCase().includes(needle))
  }, [timezoneOptions, timezoneSearch])

  const emitChange = useCallback(
    (
      dateStr: string,
      hour: number,
      minute: number,
      second: number,
      tzOverride?: string
    ) => {
      const tzToUse = tzOverride || timezone || 'UTC'
      onChange(dateStr, hour, minute, second, tzToUse)
    },
    [onChange, timezone]
  )

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {labels.waitUntil}
        </label>
        <div className="sr-only">
          <label htmlFor="delay-date-accessible">Date (UTC)</label>
          <input
            id="delay-date-accessible"
            type="date"
            value={parts.date}
            onChange={(e) =>
              emitChange(e.target.value, parts.hour, parts.minute, parts.second)
            }
          />
          <label htmlFor="delay-hour-accessible">Hour</label>
          <select
            id="delay-hour-accessible"
            value={parts.hour.toString()}
            onChange={(e) =>
              emitChange(
                parts.date,
                Number(e.target.value),
                parts.minute,
                parts.second
              )
            }
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                {i.toString().padStart(2, '0')}
              </option>
            ))}
          </select>
          <label htmlFor="delay-minute-accessible">Minute</label>
          <select
            id="delay-minute-accessible"
            value={parts.minute.toString()}
            onChange={(e) =>
              emitChange(
                parts.date,
                parts.hour,
                Number(e.target.value),
                parts.second
              )
            }
          >
            {Array.from({ length: 60 }, (_, i) => (
              <option key={i} value={i}>
                {i.toString().padStart(2, '0')}
              </option>
            ))}
          </select>
          <label htmlFor="delay-second-accessible">Second</label>
          <select
            id="delay-second-accessible"
            value={parts.second.toString()}
            onChange={(e) =>
              emitChange(
                parts.date,
                parts.hour,
                parts.minute,
                Number(e.target.value)
              )
            }
          >
            {Array.from({ length: 60 }, (_, i) => (
              <option key={i} value={i}>
                {i.toString().padStart(2, '0')}
              </option>
            ))}
          </select>
        </div>
        <div className="relative mt-2">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-300" />
          <button
            type="button"
            onClick={() => {
              setTimePickerOpen(false)
              setTimezonePickerOpen(false)
              setCalendarOpen((open) => !open)
            }}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pl-10 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
          >
            {parts.date ? formatDisplayDate(parts.date) : 'Select date (UTC)'}
          </button>
          <AnimatePresence>
            {calendarOpen ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 right-0 z-20 mt-2 w-full"
                style={{ minWidth: '100%' }}
              >
                <ScheduleCalendar
                  month={month}
                  selectedDate={parts.date}
                  todayISO={fallbackDate}
                  onMonthChange={(m) => setMonth(m)}
                  onSelectDate={(isoDate) => {
                    const nextDate = isoDate
                    setCalendarOpen(false)
                    emitChange(nextDate, parts.hour, parts.minute, parts.second)
                  }}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Time
          </label>
          <div className="relative mt-2">
            <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-300" />
            <button
              type="button"
              onClick={() => {
                setCalendarOpen(false)
                setTimezonePickerOpen(false)
                setTimePickerOpen((open) => !open)
              }}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pl-10 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
            >
              {parts.valid
                ? formatDisplayTime(selectedTimeString)
                : 'Select time'}
            </button>
            <AnimatePresence>
              {timePickerOpen ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 right-0 z-20 mt-2"
                >
                  <ScheduleTimePicker
                    selectedTime={selectedTimeParts}
                    onSelect={(time) => {
                      const parsed = parseTime(time)
                      const hours = parsed?.hours ?? 0
                      const minutes = parsed?.minutes ?? 0
                      const seconds = parts.second ?? 0
                      setTimePickerOpen(false)
                      emitChange(parts.date, hours, minutes, seconds)
                    }}
                    onClose={() => setTimePickerOpen(false)}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Timezone
          </label>
          <div className="relative mt-2">
            <Globe2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-300" />
            <button
              type="button"
              onClick={() => {
                setCalendarOpen(false)
                setTimePickerOpen(false)
                setTimezonePickerOpen((open) => !open)
              }}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pl-10 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
            >
              {timezone || 'Select timezone'}
            </button>
            <AnimatePresence>
              {timezonePickerOpen ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 z-30 mt-2"
                >
                  <ScheduleTimezonePicker
                    options={filteredTimezones}
                    selectedTimezone={timezone}
                    search={timezoneSearch}
                    onSearchChange={(value) => setTimezoneSearch(value)}
                    onSelect={(tz) => {
                      setTimezone(tz)
                      setTimezonePickerOpen(false)
                      setTimezoneSearch('')
                      emitChange(
                        parts.date,
                        parts.hour,
                        parts.minute,
                        parts.second,
                        tz
                      )
                    }}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        Date/time is captured in UTC and saved as ISO 8601.
      </p>
    </div>
  )
}

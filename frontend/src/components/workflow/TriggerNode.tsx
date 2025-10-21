import { memo, useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  CalendarDays,
  Clock,
  Globe2,
  RefreshCcw
} from 'lucide-react'
import TriggerTypeDropdown from './TriggerTypeDropdown'
import KeyValuePair from '../ui/react-flow/KeyValuePair'
import {
  CalendarMonth,
  formatDisplayDate,
  formatDisplayTime,
  getInitialMonth,
  parseTime,
  toISODateString
} from '../ui/schedule/utils'
import { ScheduleCalendar } from '../ui/schedule/ScheduleCalendar'
import { ScheduleTimePicker } from '../ui/schedule/ScheduleTimePicker'
import { ScheduleTimezonePicker } from '../ui/schedule/ScheduleTimezonePicker'
import { normalizePlanTier } from '@/lib/planTiers'

const SCHEDULE_RESTRICTION_MESSAGE =
  'Scheduled triggers are available on workspace plans and above. Switch this trigger to Manual or Webhook to keep running on the solo plan.'

const repeatUnits = ['minutes', 'hours', 'days', 'weeks'] as const
type RepeatUnit = (typeof repeatUnits)[number]

type ScheduleConfig = {
  startDate: string
  startTime: string
  timezone: string
  repeat?: {
    every: number
    unit: RepeatUnit
  }
}

function cloneScheduleConfig(config?: ScheduleConfig) {
  if (!config) return undefined
  return {
    startDate: config.startDate,
    startTime: config.startTime,
    timezone: config.timezone,
    repeat: config.repeat
      ? { every: config.repeat.every, unit: config.repeat.unit }
      : undefined
  }
}

function scheduleConfigsEqual(a: ScheduleConfig, b: ScheduleConfig) {
  if (a.startDate !== b.startDate) return false
  if (a.startTime !== b.startTime) return false
  if (a.timezone !== b.timezone) return false

  const repeatA = a.repeat
  const repeatB = b.repeat
  if (!repeatA && !repeatB) return true
  if (!repeatA || !repeatB) return false
  return repeatA.every === repeatB.every && repeatA.unit === repeatB.unit
}

type TriggerInput = {
  key: string
  value: string
}

type NodeUpdatePayload = {
  label: string
  inputs: TriggerInput[]
  dirty: boolean
  expanded: boolean
  triggerType: string
  scheduleConfig?: ScheduleConfig
  hasValidationErrors: boolean
}

type NodeStatusSnapshot = {
  isRunning: boolean
  isSucceeded: boolean
  isFailed: boolean
}

type TriggerNodeData = {
  id?: string
  label?: string
  expanded?: boolean
  inputs?: TriggerInput[]
  dirty?: boolean
  triggerType?: string
  scheduleConfig?: Partial<ScheduleConfig>
  labelError?: string | null
  wfEpoch?: number
  nodeStatus?: Partial<NodeStatusSnapshot> & {
    running?: boolean
    succeeded?: boolean
    failed?: boolean
  }
  status?: Partial<NodeStatusSnapshot> & {
    running?: boolean
    succeeded?: boolean
    failed?: boolean
  }
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
}

const EMPTY_TRIGGER_NODE_DATA: TriggerNodeData = Object.freeze({})

function deriveNodeStatus(data?: TriggerNodeData): NodeStatusSnapshot {
  if (!data) {
    return { isRunning: false, isSucceeded: false, isFailed: false }
  }

  const nested =
    (typeof data.nodeStatus === 'object' && data.nodeStatus) ||
    (typeof data.status === 'object' && data.status) ||
    {}
  const nestedRecord = nested as Record<string, unknown>

  const resolve = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value
    return Boolean(value)
  }

  const isRunning = resolve(
    data.isRunning ?? nestedRecord.isRunning ?? nestedRecord.running
  )
  const isSucceeded = resolve(
    data.isSucceeded ?? nestedRecord.isSucceeded ?? nestedRecord.succeeded
  )
  const isFailed = resolve(
    data.isFailed ?? nestedRecord.isFailed ?? nestedRecord.failed
  )

  return { isRunning, isSucceeded, isFailed }
}

interface TriggerNodeProps {
  id: string
  data?: TriggerNodeData
  selected: boolean
  onLabelChange?: (id: string, label: string) => void
  onRun?: (id: string, inputs: TriggerInput[]) => Promise<void> | void
  onRemove?: (id: string) => void
  onChange?: (
    id: string,
    data: NodeUpdatePayload,
    suppressDirty?: boolean
  ) => void
  markDirty?: () => void
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
}

function inputsEqual(a: TriggerInput[], b: TriggerInput[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].key !== b[i].key || a[i].value !== b[i].value) {
      return false
    }
  }
  return true
}

function nodeUpdatesEqual(
  a: NodeUpdatePayload | undefined,
  b: NodeUpdatePayload
) {
  if (!a) return false
  if (a.label !== b.label) return false
  if (a.dirty !== b.dirty) return false
  if (a.expanded !== b.expanded) return false
  if (a.triggerType !== b.triggerType) return false
  if (a.hasValidationErrors !== b.hasValidationErrors) return false
  if (!inputsEqual(a.inputs, b.inputs)) return false

  const scheduleA = a.scheduleConfig
  const scheduleB = b.scheduleConfig
  if (!scheduleA && !scheduleB) return true
  if (!scheduleA || !scheduleB) return false
  return scheduleConfigsEqual(scheduleA, scheduleB)
}

function normalizeScheduleConfig(
  value: any,
  fallbackTimezone: string
): ScheduleConfig {
  const startDate = typeof value?.startDate === 'string' ? value.startDate : ''
  const startTime = typeof value?.startTime === 'string' ? value.startTime : ''
  const timezone =
    typeof value?.timezone === 'string' && value.timezone.trim().length > 0
      ? value.timezone
      : fallbackTimezone

  let repeat: ScheduleConfig['repeat']
  if (value && typeof value === 'object' && value.repeat) {
    const rawEvery = Number(value.repeat?.every)
    if (Number.isFinite(rawEvery) && rawEvery > 0) {
      const candidate =
        typeof value.repeat?.unit === 'string'
          ? value.repeat.unit.toLowerCase()
          : 'days'
      const unit: RepeatUnit = repeatUnits.includes(candidate as RepeatUnit)
        ? (candidate as RepeatUnit)
        : 'days'
      repeat = {
        every: Math.floor(rawEvery),
        unit
      }
    }
  }

  return {
    startDate,
    startTime,
    timezone,
    repeat
  }
}

function TriggerNode({
  id,
  data,
  selected,
  onLabelChange,
  onRun,
  onRemove,
  onChange,
  markDirty,
  planTier,
  onRestrictionNotice
}: TriggerNodeProps) {
  const normalizedPlanTier = useMemo(
    () => normalizePlanTier(planTier),
    [planTier]
  )
  const isSoloPlan = normalizedPlanTier === 'solo'

  const defaultTimezone = useMemo(() => {
    try {
      return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }, [])
  const nodeData = useMemo(
    () => (data ?? EMPTY_TRIGGER_NODE_DATA) as TriggerNodeData,
    [data]
  )
  const nodeDerived = useMemo(() => {
    const isNewNode = !nodeData?.id
    const dirty =
      typeof nodeData?.dirty === 'boolean' ? nodeData.dirty : isNewNode
    return {
      dirty,
      expanded: Boolean(nodeData?.expanded),
      wfEpoch: nodeData?.wfEpoch ?? 0
    }
  }, [nodeData])
  const label = nodeData.label ?? 'Trigger'
  const rawInputs = nodeData.inputs
  const inputs = useMemo<TriggerInput[]>(
    () => (Array.isArray(rawInputs) ? (rawInputs as TriggerInput[]) : []),
    [rawInputs]
  )
  const triggerType = nodeData?.triggerType ?? 'Manual'
  const rawScheduleConfig = nodeData.scheduleConfig
  const labelError = nodeData.labelError ?? null
  const expanded = nodeDerived.expanded
  const dirty = nodeDerived.dirty
  const wfEpoch = nodeDerived.wfEpoch
  const { isRunning, isSucceeded, isFailed } = useMemo(
    () => deriveNodeStatus(nodeData),
    [nodeData]
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const scheduleConfig = useMemo(
    () => normalizeScheduleConfig(rawScheduleConfig, defaultTimezone),
    [rawScheduleConfig, defaultTimezone]
  )
  const normalizedTriggerType = useMemo(
    () =>
      typeof triggerType === 'string'
        ? triggerType.trim().toLowerCase()
        : 'manual',
    [triggerType]
  )
  const scheduleRestricted = isSoloPlan && normalizedTriggerType === 'schedule'
  const scheduleRestrictionMessage = scheduleRestricted
    ? SCHEDULE_RESTRICTION_MESSAGE
    : null
  const timezoneOptions = useMemo(() => {
    const options: string[] = []
    if (typeof Intl !== 'undefined') {
      const maybeSupported = (Intl as any).supportedValuesOf
      if (typeof maybeSupported === 'function') {
        try {
          const supported = maybeSupported('timeZone')
          if (Array.isArray(supported)) {
            options.push(...supported)
          }
        } catch {
          /* ignore */
        }
      }
    }
    options.push(defaultTimezone || 'UTC')
    options.push('UTC')
    if (scheduleConfig.timezone) {
      options.push(scheduleConfig.timezone)
    }
    return Array.from(new Set(options))
  }, [defaultTimezone, scheduleConfig.timezone])
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [timePickerOpen, setTimePickerOpen] = useState(false)
  const [timezonePickerOpen, setTimezonePickerOpen] = useState(false)
  const [timezoneSearch, setTimezoneSearch] = useState('')
  const [datePickerMonth, setDatePickerMonth] = useState<CalendarMonth>(() =>
    getInitialMonth(scheduleConfig.startDate)
  )
  const datePickerContainerRef = useRef<HTMLDivElement | null>(null)
  const timePickerContainerRef = useRef<HTMLDivElement | null>(null)
  const timezonePickerContainerRef = useRef<HTMLDivElement | null>(null)
  const lastNodeUpdateRef = useRef<NodeUpdatePayload | undefined>(undefined)
  const lastPlanNoticeRef = useRef<string | null>(null)

  const selectedTime = useMemo(
    () => parseTime(scheduleConfig.startTime),
    [scheduleConfig.startTime]
  )
  const filteredTimezoneOptions = useMemo(() => {
    const needle = timezoneSearch.trim().toLowerCase()
    if (!needle) return timezoneOptions
    return timezoneOptions.filter((tz) => tz.toLowerCase().includes(needle))
  }, [timezoneOptions, timezoneSearch])
  const todayISO = useMemo(() => {
    const now = new Date()
    return toISODateString(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  useEffect(() => {
    setDatePickerMonth((prev: CalendarMonth) => {
      const next = getInitialMonth(scheduleConfig.startDate)
      return prev.year === next.year && prev.month === next.month ? prev : next
    })
  }, [scheduleConfig.startDate])

  useEffect(() => {
    if (triggerType === 'Schedule') return
    setDatePickerOpen(false)
    setTimePickerOpen(false)
    setTimezonePickerOpen(false)
  }, [triggerType])

  useEffect(() => {
    if (!datePickerOpen) return
    const handleMouseDown = (event: MouseEvent) => {
      if (!datePickerContainerRef.current?.contains(event.target as Node)) {
        setDatePickerOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDatePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [datePickerOpen])

  useEffect(() => {
    if (!timePickerOpen) return
    const handleMouseDown = (event: MouseEvent) => {
      if (!timePickerContainerRef.current?.contains(event.target as Node)) {
        setTimePickerOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTimePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [timePickerOpen])

  useEffect(() => {
    if (!timezonePickerOpen) {
      setTimezoneSearch('')
      return
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (!timezonePickerContainerRef.current?.contains(event.target as Node)) {
        setTimezonePickerOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTimezonePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [timezonePickerOpen])

  useEffect(() => {
    if (!onRestrictionNotice) return
    if (scheduleRestrictionMessage) {
      if (lastPlanNoticeRef.current === scheduleRestrictionMessage) return
      lastPlanNoticeRef.current = scheduleRestrictionMessage
      onRestrictionNotice(scheduleRestrictionMessage)
    } else {
      lastPlanNoticeRef.current = null
    }
  }, [scheduleRestrictionMessage, onRestrictionNotice])

  const openPlanSettings = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error((err as Error).message)
    }
  }, [])

  const evaluateInputs = useCallback((candidate: TriggerInput[]) => {
    if (!candidate || candidate.length === 0) {
      return { hasInvalidInputs: false, hasDuplicateKeys: false }
    }
    const trimmedKeys = candidate.map((input) => input.key.trim())
    const trimmedValues = candidate.map((input) => input.value.trim())
    const hasInvalidInputs =
      trimmedKeys.some((key) => !key) || trimmedValues.some((value) => !value)
    const filteredKeys = trimmedKeys.filter((key) => key)
    const hasDuplicateKeys = new Set(filteredKeys).size !== filteredKeys.length
    return { hasInvalidInputs, hasDuplicateKeys }
  }, [])

  const { hasInvalidInputs, hasDuplicateKeys } = useMemo(
    () => evaluateInputs(inputs),
    [inputs, evaluateInputs]
  )

  const computeHasValidationErrors = useCallback(
    (overrides?: {
      inputs?: TriggerInput[]
      labelError?: string | null
      triggerType?: string
    }) => {
      const nextInputs = overrides?.inputs ?? inputs
      const nextLabelError =
        overrides && 'labelError' in overrides
          ? overrides.labelError
          : labelError
      const nextTriggerType = overrides?.triggerType ?? triggerType
      const { hasInvalidInputs: nextInvalid, hasDuplicateKeys: nextDuplicate } =
        evaluateInputs(nextInputs)
      const normalizedNextTriggerType =
        typeof nextTriggerType === 'string'
          ? nextTriggerType.trim().toLowerCase()
          : 'manual'
      const nextScheduleRestricted =
        isSoloPlan && normalizedNextTriggerType === 'schedule'
      return (
        nextDuplicate ||
        nextInvalid ||
        Boolean(nextLabelError) ||
        nextScheduleRestricted
      )
    },
    [evaluateInputs, inputs, labelError, triggerType, isSoloPlan]
  )

  const combinedHasValidationErrors = useMemo(
    () => computeHasValidationErrors(),
    [computeHasValidationErrors]
  )

  useEffect(() => {
    lastNodeUpdateRef.current = undefined
  }, [id, wfEpoch])

  const handleChange = useCallback(
    (
      partial: Partial<NodeUpdatePayload>,
      options?: { suppressDirty?: boolean }
    ) => {
      const nextInputs = partial.inputs ?? inputs
      const nextLabel = partial.label ?? label
      const nextTriggerType = partial.triggerType ?? triggerType
      const nextLabelError =
        partial.labelError !== undefined ? partial.labelError : labelError
      const nextDirty = partial.dirty ?? dirty
      const nextExpanded = partial.expanded ?? expanded
      const nextScheduleConfigCandidate =
        partial.scheduleConfig ?? scheduleConfig
      const nextHasValidationErrors =
        partial.hasValidationErrors ??
        computeHasValidationErrors({
          inputs: nextInputs,
          labelError: nextLabelError,
          triggerType: nextTriggerType
        })
      const normalizedNextTriggerType =
        typeof nextTriggerType === 'string'
          ? nextTriggerType.trim().toLowerCase()
          : 'manual'
      const payload: NodeUpdatePayload = {
        label: nextLabel,
        inputs: nextInputs,
        dirty: nextDirty,
        expanded: nextExpanded,
        triggerType: nextTriggerType,
        hasValidationErrors: nextHasValidationErrors,
        ...(normalizedNextTriggerType === 'schedule' &&
        nextScheduleConfigCandidate
          ? { scheduleConfig: nextScheduleConfigCandidate }
          : {})
      }

      if (nodeUpdatesEqual(lastNodeUpdateRef.current, payload)) {
        return
      }

      lastNodeUpdateRef.current = {
        ...payload,
        inputs: payload.inputs.map((input) => ({ ...input })),
        scheduleConfig: cloneScheduleConfig(payload.scheduleConfig)
      }

      onChange?.(id, payload, options?.suppressDirty ?? false)
      if (payload.dirty && !options?.suppressDirty) {
        markDirty?.()
      }
    },
    [
      computeHasValidationErrors,
      dirty,
      expanded,
      id,
      inputs,
      label,
      labelError,
      markDirty,
      onChange,
      scheduleConfig,
      triggerType
    ]
  )

  const updateSchedule = useCallback(
    (updater: (previous: ScheduleConfig) => ScheduleConfig) => {
      const next = updater(scheduleConfig)
      if (scheduleConfigsEqual(scheduleConfig, next)) {
        return
      }
      handleChange({ scheduleConfig: next, dirty: true })
    },
    [handleChange, scheduleConfig]
  )

  const handleRun = async () => {
    setRunning(true)
    try {
      await onRun?.(id, inputs)
    } finally {
      setRunning(false)
    }
  }
  const repeatEnabled = !!scheduleConfig.repeat

  const ringClass = isFailed
    ? 'ring-2 ring-red-500'
    : isSucceeded
      ? 'ring-2 ring-emerald-500'
      : isRunning
        ? 'ring-2 ring-sky-500'
        : ''
  return (
    <motion.div
      className={`wf-node relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? 'ring-2 ring-blue-500' : 'border-zinc-300 dark:border-zinc-700'} ${ringClass}`}
      style={{
        width: expanded ? 'auto' : 256,
        minWidth: expanded ? 256 : undefined,
        maxWidth: expanded ? 400 : undefined
      }}
    >
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 14,
          height: 14,
          backgroundColor: 'green',
          border: '2px solid white'
        }}
      />
      <div className="p-3">
        <div className="flex justify-between items-center">
          {editing ? (
            <input
              value={label}
              onChange={(e) => {
                const nextValue = e.target.value
                const hasChanged = nextValue !== label
                handleChange({
                  label: nextValue,
                  dirty: hasChanged ? true : dirty
                })
              }}
              onBlur={() => {
                setEditing(false)
                onLabelChange?.(id, label)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur() // triggers onBlur
                }
              }}
              className="text-sm font-semibold bg-transparent border-b border-zinc-400 focus:outline-none w-full"
            />
          ) : (
            <h3
              onDoubleClick={() => setEditing(true)}
              className="text-sm font-semibold cursor-pointer relative"
            >
              {label}
              {(dirty || combinedHasValidationErrors) && (
                <span className="absolute -right-3 top-1 w-2 h-2 rounded-full bg-blue-500" />
              )}
            </h3>
          )}
          <div className="flex gap-1">
            <button
              onClick={() =>
                handleChange({ expanded: !expanded }, { suppressDirty: true })
              }
              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
              title="Delete node"
            >
              <Trash2 size={16} className="text-red-600" />
            </button>
          </div>
        </div>

        {labelError && (
          <p className="mt-2 text-xs text-red-500">{labelError}</p>
        )}
        <button
          onClick={handleRun}
          disabled={running || combinedHasValidationErrors}
          className="mt-2 w-full py-1 text-sm rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run'}
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              key="expanded-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2"
            >
              <p className="text-xs text-zinc-500 mt-2">Trigger Type</p>
              <TriggerTypeDropdown
                value={triggerType}
                onChange={(type) => {
                  if (type === triggerType) return
                  handleChange({ triggerType: type, dirty: true })
                }}
                disabledOptions={
                  isSoloPlan ? { Schedule: SCHEDULE_RESTRICTION_MESSAGE } : {}
                }
                onBlockedSelect={(value, reason) => {
                  if (!onRestrictionNotice) return
                  const fallback =
                    value === 'Schedule'
                      ? SCHEDULE_RESTRICTION_MESSAGE
                      : 'This trigger is locked on your current plan.'
                  onRestrictionNotice(reason || fallback)
                }}
              />
              {triggerType === 'Schedule' ? (
                scheduleRestricted ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="flex items-start justify-between gap-2">
                      <span>{SCHEDULE_RESTRICTION_MESSAGE}</span>
                      <button
                        type="button"
                        onClick={openPlanSettings}
                        className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-400/10"
                      >
                        Upgrade
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 rounded-xl border border-zinc-200/70 bg-zinc-50/60 p-4 text-sm shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900/40">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        Start Date
                      </label>
                      <div
                        ref={datePickerContainerRef}
                        className="relative mt-2"
                      >
                        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-300" />
                        <button
                          type="button"
                          onClick={() => {
                            setTimePickerOpen(false)
                            setTimezonePickerOpen(false)
                            setDatePickerOpen((prev) => !prev)
                          }}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pl-10 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                        >
                          {formatDisplayDate(scheduleConfig.startDate)}
                        </button>
                        <AnimatePresence>
                          {datePickerOpen && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: -4 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -4 }}
                              transition={{ duration: 0.15 }}
                              className="absolute left-0 right-0 z-20 mt-2"
                            >
                              <ScheduleCalendar
                                month={datePickerMonth}
                                selectedDate={scheduleConfig.startDate}
                                todayISO={todayISO}
                                onMonthChange={(nextMonth: CalendarMonth) =>
                                  setDatePickerMonth(nextMonth)
                                }
                                onSelectDate={(isoDate: string) => {
                                  updateSchedule((prev) => ({
                                    ...prev,
                                    startDate: isoDate
                                  }))
                                  setDatePickerOpen(false)
                                }}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Start Time
                        </label>
                        <div
                          ref={timePickerContainerRef}
                          className="relative mt-2"
                        >
                          <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-300" />
                          <button
                            type="button"
                            onClick={() => {
                              setDatePickerOpen(false)
                              setTimezonePickerOpen(false)
                              setTimePickerOpen((prev) => !prev)
                            }}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pl-10 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                          >
                            {formatDisplayTime(scheduleConfig.startTime)}
                          </button>
                          <AnimatePresence>
                            {timePickerOpen && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                transition={{ duration: 0.15 }}
                                className="absolute left-0 right-0 z-20 mt-2"
                              >
                                <ScheduleTimePicker
                                  selectedTime={selectedTime}
                                  onSelect={(time: string) => {
                                    updateSchedule((prev) => ({
                                      ...prev,
                                      startTime: time
                                    }))
                                  }}
                                  onClose={() => setTimePickerOpen(false)}
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Timezone
                        </label>
                        <div
                          ref={timezonePickerContainerRef}
                          className="relative mt-2"
                        >
                          <Globe2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-300" />
                          <button
                            type="button"
                            onClick={() => {
                              setDatePickerOpen(false)
                              setTimePickerOpen(false)
                              setTimezonePickerOpen((prev) => !prev)
                            }}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pl-10 text-left text-sm font-medium text-zinc-900 shadow-sm transition hover:border-blue-400 hover:shadow focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                          >
                            {scheduleConfig.timezone || 'Select timezone'}
                          </button>
                          <AnimatePresence>
                            {timezonePickerOpen && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                transition={{ duration: 0.15 }}
                                className="absolute left-0 z-30 mt-2"
                              >
                                <ScheduleTimezonePicker
                                  options={filteredTimezoneOptions}
                                  selectedTimezone={scheduleConfig.timezone}
                                  search={timezoneSearch}
                                  onSearchChange={(value: string) =>
                                    setTimezoneSearch(value)
                                  }
                                  onSelect={(timezone: string) => {
                                    updateSchedule((prev) => ({
                                      ...prev,
                                      timezone
                                    }))
                                    setTimezonePickerOpen(false)
                                  }}
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3 rounded-lg border border-transparent bg-white/60 p-3 shadow-inner transition dark:bg-zinc-900/60">
                      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </span>
                        Repeat schedule
                        <span className="text-[10px] font-normal uppercase text-zinc-400 dark:text-zinc-500">
                          Optional
                        </span>
                        <input
                          type="checkbox"
                          className="ml-auto h-4 w-4 accent-blue-500"
                          checked={repeatEnabled}
                          onChange={(e) => {
                            const enable = e.target.checked
                            updateSchedule((prev) => ({
                              ...prev,
                              repeat: enable
                                ? (prev.repeat ?? { every: 1, unit: 'days' })
                                : undefined
                            }))
                          }}
                        />
                      </label>
                      {repeatEnabled && (
                        <div className="flex flex-col gap-3 rounded-md bg-zinc-100/70 p-3 dark:bg-zinc-800/60 sm:flex-row sm:items-center">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                              Every
                            </span>
                            <input
                              type="number"
                              min={1}
                              value={scheduleConfig.repeat?.every ?? 1}
                              onChange={(e) => {
                                const parsed = Number.parseInt(
                                  e.target.value,
                                  10
                                )
                                const every =
                                  Number.isFinite(parsed) && parsed > 0
                                    ? parsed
                                    : 1
                                updateSchedule((prev) => ({
                                  ...prev,
                                  repeat: {
                                    every,
                                    unit: prev.repeat?.unit ?? 'days'
                                  }
                                }))
                              }}
                              className="h-10 w-24 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                            />
                          </div>
                          <select
                            value={scheduleConfig.repeat?.unit ?? 'days'}
                            onChange={(e) => {
                              const rawValue = e.target.value as RepeatUnit
                              const unit = repeatUnits.includes(rawValue)
                                ? rawValue
                                : 'days'
                              updateSchedule((prev) => ({
                                ...prev,
                                repeat: {
                                  every: prev.repeat?.every ?? 1,
                                  unit
                                }
                              }))
                            }}
                            className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-8 text-sm font-semibold capitalize text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 sm:w-40"
                          >
                            {repeatUnits.map((unit) => (
                              <option key={unit} value={unit}>
                                {unit.charAt(0).toUpperCase() + unit.slice(1)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )
              ) : null}
              <KeyValuePair
                key={`kv-${id}-${wfEpoch ?? ''}`}
                title="Input Variables"
                variables={inputs}
                onChange={(
                  updatedVars: TriggerInput[],
                  _nodeHasErrors,
                  childDirty: boolean
                ) => {
                  const nextDirty =
                    dirty || childDirty || !inputsEqual(inputs, updatedVars)
                  handleChange({
                    inputs: updatedVars,
                    dirty: nextDirty
                  })
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {confirmingDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl"
          >
            <div className="bg-white dark:bg-zinc-800 p-4 rounded-xl shadow-md w-56">
              <p className="text-sm mb-3">Delete this node?</p>
              <p className="text-sm mb-3">This action can not be undone</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-2 py-1 text-xs rounded border"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setConfirmingDelete(false)
                    onRemove?.(id)
                  }}
                  className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default memo(TriggerNode)

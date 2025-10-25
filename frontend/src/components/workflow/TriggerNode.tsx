import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'
import {
  ArrowUpRight,
  ChevronUp,
  ChevronDown,
  Trash2,
  CalendarDays,
  Clock,
  Globe2,
  RefreshCcw
} from 'lucide-react'
import TriggerTypeDropdown from './TriggerTypeDropdown'
import KeyValuePair from '../UI/ReactFlow/KeyValuePair'
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
import BaseNode, { type BaseNodeRenderProps } from './BaseNode'
import { normalizePlanTier } from '@/lib/planTiers'
import { useWorkflowStore, type WorkflowState } from '@/stores/workflowStore'
import { useWorkflowFlyout } from '@/components/workflow/useWorkflowFlyout'

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

type TriggerInput = {
  key: string
  value: string
}

type TriggerNodeData = {
  id?: string
  label?: string
  expanded?: boolean
  inputs?: TriggerInput[]
  dirty?: boolean
  triggerType?: string
  scheduleConfig?: ScheduleConfig
  labelError?: string | null
  wfEpoch?: number
  hasValidationErrors?: boolean
}

interface TriggerNodeProps {
  id: string
  selected: boolean
  onRun?: (id: string, inputs: TriggerInput[]) => Promise<void>
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
  canEdit?: boolean
}

type TriggerNodeContentProps = BaseNodeRenderProps<TriggerNodeData> & {
  onRun?: (id: string, inputs: TriggerInput[]) => Promise<void>
  externalIsRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  isSoloPlan: boolean
  onRestrictionNotice?: (message: string) => void
  defaultTimezone: string
}

export default function TriggerNode({
  id,
  selected,
  onRun,
  isRunning,
  isSucceeded,
  isFailed,
  planTier,
  onRestrictionNotice,
  canEdit = true
}: TriggerNodeProps) {
  const selectNodeData = useMemo(
    () => (state: WorkflowState) =>
      state.nodes.find((node) => node.id === id)?.data as
        | TriggerNodeData
        | undefined,
    [id]
  )
  const nodeData = useWorkflowStore(selectNodeData)

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

  return (
    <BaseNode<TriggerNodeData>
      id={id}
      selected={selected}
      canEdit={canEdit}
      fallbackLabel="Trigger"
      defaultDirty={!nodeData}
    >
      {(renderProps) => (
        <TriggerNodeContent
          {...renderProps}
          onRun={onRun}
          externalIsRunning={isRunning}
          isSucceeded={isSucceeded}
          isFailed={isFailed}
          isSoloPlan={isSoloPlan}
          onRestrictionNotice={onRestrictionNotice}
          defaultTimezone={defaultTimezone}
        />
      )}
    </BaseNode>
  )
}

function TriggerNodeContent({
  id,
  selected,
  label,
  expanded,
  dirty,
  nodeData,
  updateData,
  toggleExpanded,
  remove,
  effectiveCanEdit,
  onRun,
  externalIsRunning,
  isSucceeded,
  isFailed,
  isSoloPlan,
  onRestrictionNotice,
  defaultTimezone
}: TriggerNodeContentProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [running, setRunning] = useState(false)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [timePickerOpen, setTimePickerOpen] = useState(false)
  const [timezonePickerOpen, setTimezonePickerOpen] = useState(false)
  const [timezoneSearch, setTimezoneSearch] = useState('')
  const { openFlyout, activeNodeId, isFlyoutRender } = useWorkflowFlyout()
  const flyoutActive = activeNodeId === id
  const showFlyoutShortcut = !isFlyoutRender

  const rawInputs = nodeData?.inputs
  const inputs = useMemo<TriggerInput[]>(
    () =>
      Array.isArray(rawInputs)
        ? rawInputs.map((input) => ({
            key: input?.key ?? '',
            value: input?.value ?? ''
          }))
        : [],
    [rawInputs]
  )

  const triggerType =
    typeof nodeData?.triggerType === 'string' ? nodeData.triggerType : 'Manual'
  const normalizedTriggerType = useMemo(
    () => triggerType.trim().toLowerCase() || 'manual',
    [triggerType]
  )

  const scheduleConfig = useMemo(
    () => normalizeScheduleConfig(nodeData?.scheduleConfig, defaultTimezone),
    [nodeData?.scheduleConfig, defaultTimezone]
  )

  const [datePickerMonth, setDatePickerMonth] = useState<CalendarMonth>(() =>
    getInitialMonth(scheduleConfig.startDate)
  )

  useEffect(() => {
    setDatePickerMonth((prev) => {
      const next = getInitialMonth(scheduleConfig.startDate)
      return prev.year === next.year && prev.month === next.month ? prev : next
    })
  }, [scheduleConfig.startDate])

  const datePickerContainerRef = useRef<HTMLDivElement | null>(null)
  const timePickerContainerRef = useRef<HTMLDivElement | null>(null)
  const timezonePickerContainerRef = useRef<HTMLDivElement | null>(null)
  const lastPlanNoticeRef = useRef<string | null>(null)

  const scheduleRestricted = isSoloPlan && normalizedTriggerType === 'schedule'
  const scheduleRestrictionMessage = scheduleRestricted
    ? SCHEDULE_RESTRICTION_MESSAGE
    : null

  useEffect(() => {
    if (!onRestrictionNotice || !scheduleRestrictionMessage) {
      lastPlanNoticeRef.current = null
      return
    }
    if (lastPlanNoticeRef.current === scheduleRestrictionMessage) return
    lastPlanNoticeRef.current = scheduleRestrictionMessage
    onRestrictionNotice(scheduleRestrictionMessage)
  }, [scheduleRestrictionMessage, onRestrictionNotice])

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

  const filteredTimezoneOptions = useMemo(() => {
    const needle = timezoneSearch.trim().toLowerCase()
    if (!needle) return timezoneOptions
    return timezoneOptions.filter((tz) => tz.toLowerCase().includes(needle))
  }, [timezoneOptions, timezoneSearch])

  const selectedTime = useMemo(
    () => parseTime(scheduleConfig.startTime),
    [scheduleConfig.startTime]
  )

  const todayISO = useMemo(() => {
    const now = new Date()
    return toISODateString(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  useEffect(() => {
    if (normalizedTriggerType === 'schedule') return
    setDatePickerOpen(false)
    setTimePickerOpen(false)
    setTimezonePickerOpen(false)
  }, [normalizedTriggerType])

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

  const openPlanSettings = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error((err as Error).message)
    }
  }, [])

  const updateSchedule = useCallback(
    (updater: (previous: ScheduleConfig) => ScheduleConfig) => {
      if (!effectiveCanEdit) return
      const next = updater(scheduleConfig)
      if (scheduleConfigsEqual(scheduleConfig, next)) {
        return
      }
      updateData({ scheduleConfig: next, dirty: true })
    },
    [effectiveCanEdit, scheduleConfig, updateData]
  )

  const hasInvalidInputs = useMemo(() => {
    if (inputs.length === 0) return false
    return inputs.some((input) => !input.key.trim() || !input.value.trim())
  }, [inputs])

  const hasDuplicateKeys = useMemo(() => {
    const keys = inputs.map((input) => input.key.trim()).filter(Boolean)
    return new Set(keys).size !== keys.length
  }, [inputs])

  const labelError = nodeData?.labelError ?? null

  const combinedHasValidationErrors =
    hasDuplicateKeys ||
    hasInvalidInputs ||
    Boolean(labelError) ||
    scheduleRestricted

  useEffect(() => {
    if (!effectiveCanEdit) return
    if (
      (nodeData?.hasValidationErrors ?? false) === combinedHasValidationErrors
    ) {
      return
    }
    updateData({ hasValidationErrors: combinedHasValidationErrors })
  }, [
    combinedHasValidationErrors,
    effectiveCanEdit,
    nodeData?.hasValidationErrors,
    updateData
  ])

  const handleLabelChange = useCallback(
    (nextLabel: string) => {
      if (!effectiveCanEdit) return
      updateData({ label: nextLabel, dirty: true })
    },
    [effectiveCanEdit, updateData]
  )

  const handleTriggerTypeChange = useCallback(
    (value: string) => {
      if (!effectiveCanEdit) return
      if (value === 'Schedule' && scheduleRestricted) {
        openPlanSettings()
        return
      }
      updateData({ triggerType: value, dirty: true })
    },
    [effectiveCanEdit, openPlanSettings, scheduleRestricted, updateData]
  )

  const handleBlockedTriggerSelect = useCallback(
    (value: string) => {
      if (value === 'Schedule') {
        openPlanSettings()
      }
    },
    [openPlanSettings]
  )

  const handleInputsChange = useCallback(
    (updatedVars: TriggerInput[]) => {
      if (!effectiveCanEdit) return
      updateData({ inputs: updatedVars, dirty: true })
    },
    [effectiveCanEdit, updateData]
  )

  const handleRun = useCallback(async () => {
    setRunning(true)
    try {
      await onRun?.(id, inputs)
    } finally {
      setRunning(false)
    }
  }, [id, inputs, onRun])

  const repeatEnabled = !!scheduleConfig.repeat

  const ringClass = isFailed
    ? 'ring-2 ring-red-500'
    : isSucceeded
      ? 'ring-2 ring-emerald-500'
      : externalIsRunning
        ? 'ring-2 ring-sky-500'
        : ''

  return (
    <motion.div
      className={`wf-node group relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? 'ring-2 ring-blue-500' : 'border-zinc-300 dark:border-zinc-700'} ${ringClass}`}
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
              onChange={(event) => handleLabelChange(event.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
              }}
              className="text-sm font-semibold bg-transparent border-b border-zinc-400 focus:outline-none w-full"
            />
          ) : (
            <h3
              onDoubleClick={() => {
                if (!effectiveCanEdit) return
                setEditing(true)
              }}
              className="text-sm font-semibold cursor-pointer relative"
            >
              {label}
              {(dirty || combinedHasValidationErrors) && (
                <span className="absolute -right-3 top-1 w-2 h-2 rounded-full bg-blue-500" />
              )}
            </h3>
          )}
          <div className="flex items-center gap-1">
            {showFlyoutShortcut ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  openFlyout(id)
                }}
                className={`p-1 rounded transition text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${flyoutActive ? 'opacity-100 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-100' : ''}`}
                title="Open in detail flyout"
                aria-label="Open in detail flyout"
                aria-pressed={flyoutActive}
              >
                <ArrowUpRight size={16} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => toggleExpanded()}
              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!effectiveCanEdit) return
                setConfirmingDelete(true)
              }}
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
              className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2"
            >
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Trigger Type
                  </label>
                  <div className="mt-2">
                    <TriggerTypeDropdown
                      value={triggerType}
                      onChange={handleTriggerTypeChange}
                      disabledOptions={
                        scheduleRestricted
                          ? {
                              Schedule: SCHEDULE_RESTRICTION_MESSAGE
                            }
                          : {}
                      }
                      onBlockedSelect={handleBlockedTriggerSelect}
                    />
                    {scheduleRestricted && (
                      <p className="mt-2 text-xs text-red-500">
                        {SCHEDULE_RESTRICTION_MESSAGE}{' '}
                        <button
                          type="button"
                          onClick={openPlanSettings}
                          className="text-blue-500 hover:underline"
                        >
                          Upgrade
                        </button>
                      </p>
                    )}
                  </div>
                </div>

                {triggerType === 'Schedule' ? (
                  <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/40">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                        Schedule Settings
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          if (!effectiveCanEdit) return
                          setDatePickerOpen(false)
                          setTimePickerOpen(false)
                          setTimezonePickerOpen(false)
                          updateSchedule((prev) => {
                            if (prev.repeat) {
                              return {
                                startDate: prev.startDate,
                                startTime: prev.startTime,
                                timezone: prev.timezone
                              }
                            }
                            return {
                              ...prev,
                              repeat: {
                                every: prev.repeat?.every ?? 1,
                                unit: prev.repeat?.unit ?? 'days'
                              }
                            }
                          })
                        }}
                        className="flex items-center gap-2 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        <RefreshCcw className="h-3 w-3" />
                        {repeatEnabled ? 'Disable repeat' : 'Enable repeat'}
                      </button>
                    </div>
                    <div className="mt-4 space-y-4">
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
                              if (!effectiveCanEdit) return
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
                                  onMonthChange={(nextMonth) =>
                                    setDatePickerMonth(nextMonth)
                                  }
                                  onSelectDate={(isoDate) => {
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
                                if (!effectiveCanEdit) return
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
                                    onSelect={(time) => {
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
                                if (!effectiveCanEdit) return
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
                                    onSearchChange={(value) =>
                                      setTimezoneSearch(value)
                                    }
                                    onSelect={(timezone) => {
                                      updateSchedule((prev) => ({
                                        ...prev,
                                        timezone
                                      }))
                                      setTimezonePickerOpen(false)
                                    }}
                                    onClose={() => setTimezonePickerOpen(false)}
                                  />
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>

                      {repeatEnabled && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                              Repeat every
                            </label>
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                type="number"
                                min="1"
                                value={scheduleConfig.repeat?.every ?? 1}
                                onChange={(event) => {
                                  const rawValue = Number(event.target.value)
                                  const clamped = Number.isFinite(rawValue)
                                    ? Math.max(1, Math.floor(rawValue))
                                    : 1
                                  updateSchedule((prev) => ({
                                    ...prev,
                                    repeat: {
                                      every: clamped,
                                      unit: prev.repeat?.unit ?? 'days'
                                    }
                                  }))
                                }}
                                className="h-10 w-20 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                              />
                              <select
                                value={scheduleConfig.repeat?.unit ?? 'days'}
                                onChange={(event) => {
                                  const rawValue = event.target.value
                                  const unit = repeatUnits.includes(
                                    rawValue as RepeatUnit
                                  )
                                    ? (rawValue as RepeatUnit)
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
                                    {unit.charAt(0).toUpperCase() +
                                      unit.slice(1)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => {
                                updateSchedule((prev) => ({
                                  startDate: prev.startDate,
                                  startTime: prev.startTime,
                                  timezone: prev.timezone
                                }))
                              }}
                              className="text-xs text-red-500 hover:text-red-600"
                            >
                              Remove repeat
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <KeyValuePair
                key={`kv-${id}-${nodeData?.wfEpoch ?? ''}`}
                title="Input Variables"
                variables={inputs}
                onChange={(updatedVars) => handleInputsChange(updatedVars)}
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
                    remove()
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

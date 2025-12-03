import { useCallback, useMemo } from 'react'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import {
  normalizeDelayConfig,
  validateDelayConfig,
  type DelayConfig,
  type DurationConfig
} from './helpers'

const labels = {
  duration: 'Wait for duration',
  waitUntil: 'Or wait until a specific datetime (ISO 8601)',
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

export default function DelayNodeConfig({
  config,
  onChange,
  hasValidationErrors,
  canEdit = true
}: DelayNodeConfigProps) {
  const normalizedConfig = useMemo(() => normalizeDelayConfig(config), [config])

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

  const handleWaitUntilChange = useCallback(
    (value: string) => {
      emitConfig({
        ...normalizedConfig,
        wait_until: value
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

      <div className="space-y-1">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {labels.waitUntil}
        </label>
        <NodeInputField
          placeholder="2025-12-31T23:59:00Z"
          value={waitUntil}
          onChange={handleWaitUntilChange}
        />
      </div>

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

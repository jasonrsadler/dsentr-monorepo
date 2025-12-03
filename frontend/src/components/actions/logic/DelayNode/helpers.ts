export type DurationConfig = {
  minutes?: number
  hours?: number
  days?: number
}

export type DelayConfig = {
  wait_for?: DurationConfig
  wait_until?: string
  jitter_seconds?: number
}

const parseNumber = (value?: string | number): number | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    return Math.max(0, Math.floor(value))
  }
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.floor(parsed))
}

export const normalizeDelayConfig = (config?: DelayConfig): DelayConfig => {
  const waitFor = config?.wait_for ?? {}
  const minutes = parseNumber(waitFor.minutes)
  const hours = parseNumber(waitFor.hours)
  const days = parseNumber(waitFor.days)

  const normalizedWaitFor: DurationConfig = {
    minutes,
    hours,
    days
  }

  const trimmedWaitUntil =
    typeof config?.wait_until === 'string'
      ? config.wait_until.trim()
      : undefined

  const jitter = parseNumber(config?.jitter_seconds)

  return {
    wait_for: normalizedWaitFor,
    wait_until: trimmedWaitUntil || undefined,
    jitter_seconds: jitter
  }
}

export const validateDelayConfig = (config: DelayConfig): boolean => {
  const waitFor = config.wait_for ?? {}
  const hasDuration =
    (waitFor.minutes ?? 0) > 0 ||
    (waitFor.hours ?? 0) > 0 ||
    (waitFor.days ?? 0) > 0
  const hasAbsolute =
    typeof config.wait_until === 'string' && config.wait_until.trim().length > 0

  return !(hasDuration || hasAbsolute)
}

import { type SecretStore } from '@/lib/optionsApi'

const SECRET_PLACEHOLDER = '[REDACTED]'

const SECRET_KEY_EXACT = new Set([
  'apikey',
  'awssecretkey',
  'workflowheadersecret'
])

const SECRET_KEY_SUFFIXES = [
  'token',
  'secret',
  'password',
  'passphrase',
  'secretkey'
]

function normalizeSegment(segment: string): string {
  return segment.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isSecretKeySegment(segment: string): boolean {
  const normalized = normalizeSegment(segment)
  if (!normalized) return false
  if (SECRET_KEY_EXACT.has(normalized)) return true
  return SECRET_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

export function flattenSecretValues(store?: SecretStore): string[] {
  const seen = new Set<string>()
  const values: string[] = []

  Object.values(store ?? {}).forEach((services) => {
    Object.values(services ?? {}).forEach((entries) => {
      Object.values(entries ?? {}).forEach((value) => {
        if (typeof value !== 'string') return
        const trimmed = value.trim()
        if (!trimmed || seen.has(trimmed)) return
        seen.add(trimmed)
        values.push(trimmed)
      })
    })
  })

  return values
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function maskStringWithSecrets(
  value: string,
  secrets: string[]
): string {
  if (!value) return value

  return secrets.reduce((acc, secret) => {
    const trimmed = secret.trim()
    if (trimmed.length < 4) return acc
    const pattern = new RegExp(escapeRegExp(trimmed), 'g')
    return acc.replace(pattern, SECRET_PLACEHOLDER)
  }, value)
}

export function maskSecretsDeep(
  value: unknown,
  secrets: string[],
  forceMask = false
): unknown {
  if (forceMask) {
    return SECRET_PLACEHOLDER
  }

  if (typeof value === 'string') {
    return maskStringWithSecrets(value, secrets)
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskSecretsDeep(item, secrets, forceMask))
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      const keyIsSecret = isSecretKeySegment(key)
      result[key] = maskSecretsDeep(val, secrets, forceMask || keyIsSecret)
    })
    return result
  }

  return value
}

const PATH_DELIMITER = /[.[\]"]+/g

function extractPathSegments(path: string): string[] {
  return path
    .replace(PATH_DELIMITER, '.')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function maskValueForPath(
  value: unknown,
  path: string,
  secrets: string[]
): unknown {
  const segments = extractPathSegments(path)
  const shouldForce = segments.some((segment) => isSecretKeySegment(segment))
  return maskSecretsDeep(value, secrets, shouldForce)
}

export { SECRET_PLACEHOLDER }

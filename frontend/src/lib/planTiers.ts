export type PlanTier = 'solo' | 'workspace' | 'organization'

const SOLO_HINTS = ['solo', 'free', 'personal', 'individual']
const WORKSPACE_HINTS = ['workspace', 'team']
const ORGANIZATION_HINTS = ['organization', 'organisation', 'org', 'enterprise']

function extractKey(value: string): string {
  if (!value) return ''
  const lowered = value.trim().toLowerCase()
  if (!lowered) return ''
  const key = lowered.split(/[:_\-\s]/, 1)[0] ?? ''
  return key || lowered
}

export function normalizePlanTier(plan?: string | null): PlanTier {
  const normalized = (plan ?? '').trim().toLowerCase()
  if (!normalized) return 'solo'

  const key = extractKey(normalized)

  if (WORKSPACE_HINTS.includes(key)) {
    return 'workspace'
  }

  if (ORGANIZATION_HINTS.includes(key)) {
    return 'organization'
  }

  if (SOLO_HINTS.includes(key)) {
    return 'solo'
  }

  if (normalized.includes('workspace')) {
    return 'workspace'
  }

  if (
    normalized.includes('organization') ||
    normalized.includes('organisation')
  ) {
    return 'organization'
  }

  return 'solo'
}

export function isSoloPlan(plan?: string | null): boolean {
  return normalizePlanTier(plan) === 'solo'
}

export type InviteQueryResult = {
  token: string | null
  conflict: boolean
  needsRedirect: boolean
  canonicalSearch: string | null
  matchedKeys: string[]
}

const INVITE_KEYS = ['invite', 'invite_token', 'token', 'inv'] as const

type InviteKey = (typeof INVITE_KEYS)[number]

function normalizeInput(source: string | URLSearchParams): URLSearchParams {
  if (typeof source === 'string') {
    const trimmed = source.startsWith('?') ? source.slice(1) : source
    return new URLSearchParams(trimmed)
  }
  return new URLSearchParams(source)
}

export function parseInviteQuery(
  source: string | URLSearchParams
): InviteQueryResult {
  const params = normalizeInput(source)
  let token: string | null = null
  let conflict = false
  let sourceKey: InviteKey | null = null
  const matchedKeys: string[] = []

  for (const key of INVITE_KEYS) {
    const rawValues = params.getAll(key)
    if (rawValues.length === 0) {
      continue
    }

    matchedKeys.push(key)

    const normalizedValues = rawValues
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value && value.length > 0))

    if (normalizedValues.length === 0) {
      conflict = true
      continue
    }

    const uniqueValues = Array.from(new Set(normalizedValues))
    if (uniqueValues.length > 1) {
      conflict = true
    }

    for (const value of uniqueValues) {
      if (token === null) {
        token = value
        sourceKey = key
      } else if (value !== token) {
        conflict = true
      }
    }
  }

  if (matchedKeys.length > 1) {
    conflict = true
  }

  const needsRedirect = Boolean(!conflict && token && sourceKey !== 'invite')
  const canonicalSearch =
    needsRedirect && token ? `invite=${encodeURIComponent(token)}` : null

  return {
    token,
    conflict,
    needsRedirect,
    canonicalSearch,
    matchedKeys
  }
}

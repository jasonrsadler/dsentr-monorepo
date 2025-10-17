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
      .map((value) => sanitizeInviteValue(value))
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

// Some email clients or MTAs insert quoted-printable artifacts into URLs
// when users click/copy them, e.g.:
//   - Leading '3D' immediately after '?invite=' (encoding of '=')
//   - Soft line breaks like '...66=\n b7419...'
//   - Extraneous whitespace characters
// This sanitizer attempts to reconstruct the original token safely.
function sanitizeInviteValue(value: string | null): string | null {
  if (!value) return null
  let v = value.trim()

  // Remove quoted-printable soft line breaks ("=\r?\n") and any interspersed whitespace
  v = v.replace(/=\s*\r?\n/g, '')
  // Remove all whitespace chars that may have been introduced
  v = v.replace(/\s+/g, '')
  // Remove zero-width spaces just in case
  v = v.replace(/[\u200B\u200C\u200D]/g, '')

  // If the value starts with an uppercase '3D' (QP for '='), and the remainder
  // looks like a hex token, strip the '3D' prefix. Keep lower-case '3d' intact
  // to avoid mangling legitimate hex tokens.
  if (v.startsWith('3D')) {
    const remainder = v.slice(2)
    if (/^[0-9a-fA-F]{16,128}$/.test(remainder)) {
      v = remainder
    }
  }

  // Remove stray '=' characters that may have landed inside the token due to wrapping
  // Tokens are hex strings without '='; safe to delete them.
  v = v.replace(/=/g, '')

  return v
}
import { API_BASE_URL } from './config'

let cachedCsrfToken: string | null = null

export async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedCsrfToken) {
    return cachedCsrfToken
  }

  const res = await fetch(`${API_BASE_URL}/api/auth/csrf-token`, {
    credentials: 'include'
  })

  if (!res.ok) {
    throw new Error('Failed to fetch CSRF token')
  }

  const token = await res.text()
  cachedCsrfToken = token
  return token
}

export function invalidateCsrfToken() {
  cachedCsrfToken = null
}

import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export type OAuthProvider = 'google' | 'microsoft'

export interface ProviderConnection {
  connected: boolean
  accountEmail?: string
  expiresAt?: string
}

interface ConnectionsApiResponse {
  success: boolean
  providers: Record<
    string,
    { connected: boolean; account_email?: string; expires_at?: string }
  >
}

interface RefreshApiResponse {
  success: boolean
  account_email: string
  expires_at: string
}

export async function fetchConnections(): Promise<
  Record<OAuthProvider, ProviderConnection>
> {
  const res = await fetch(`${API_BASE_URL}/api/oauth/connections`, {
    credentials: 'include'
  })

  if (!res.ok) {
    throw new Error('Failed to load OAuth connections')
  }

  const data = (await res.json()) as ConnectionsApiResponse
  const map: Record<OAuthProvider, ProviderConnection> = {
    google: { connected: false },
    microsoft: { connected: false }
  }

  Object.entries(data.providers || {}).forEach(([key, value]) => {
    if (key === 'google' || key === 'microsoft') {
      map[key] = {
        connected: Boolean(value.connected),
        accountEmail: value.account_email ?? undefined,
        expiresAt: value.expires_at ?? undefined
      }
    }
  })

  return map
}

export async function disconnectProvider(
  provider: OAuthProvider
): Promise<void> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/oauth/${provider}/disconnect`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-csrf-token': csrfToken
    }
  })

  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => body?.message)
      .catch(() => null)
    throw new Error(message || 'Failed to disconnect provider')
  }
}

export async function refreshProvider(
  provider: OAuthProvider
): Promise<ProviderConnection> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/oauth/${provider}/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-csrf-token': csrfToken
    }
  })

  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => body?.message)
      .catch(() => null)
    throw new Error(message || 'Failed to refresh provider tokens')
  }

  const data = (await res.json()) as RefreshApiResponse
  return {
    connected: true,
    accountEmail: data.account_email,
    expiresAt: data.expires_at
  }
}

import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export type OAuthProvider = 'google' | 'microsoft'

export type ConnectionScope = 'personal' | 'workspace'

export interface BaseConnectionInfo {
  scope: ConnectionScope
  id: string | null
  connected: boolean
  accountEmail?: string
  expiresAt?: string
}

export interface PersonalConnectionInfo extends BaseConnectionInfo {
  scope: 'personal'
  isShared: boolean
}

export interface WorkspaceConnectionInfo extends BaseConnectionInfo {
  scope: 'workspace'
  workspaceId: string
  workspaceName: string
  sharedByName?: string
  sharedByEmail?: string
}

export interface ProviderConnectionSet {
  personal: PersonalConnectionInfo
  workspace: WorkspaceConnectionInfo[]
}

type ProviderConnectionMap = Record<OAuthProvider, ProviderConnectionSet>

interface PersonalConnectionPayload {
  id: string
  provider: OAuthProvider
  accountEmail: string
  expiresAt: string
  isShared: boolean
}

interface WorkspaceConnectionPayload {
  id: string
  provider: OAuthProvider
  accountEmail: string
  expiresAt: string
  workspaceId: string
  workspaceName: string
  sharedByName?: string | null
  sharedByEmail?: string | null
}

interface ConnectionsApiResponse {
  success: boolean
  personal?: PersonalConnectionPayload[] | null
  workspace?: WorkspaceConnectionPayload[] | null
}

interface RefreshApiResponse {
  success: boolean
  account_email: string
  expires_at: string
}

const defaultPersonalConnection = (): PersonalConnectionInfo => ({
  scope: 'personal',
  id: null,
  connected: false,
  accountEmail: undefined,
  expiresAt: undefined,
  isShared: false
})

const defaultProviderConnections = (): ProviderConnectionSet => ({
  personal: defaultPersonalConnection(),
  workspace: []
})

export async function fetchConnections(): Promise<ProviderConnectionMap> {
  const res = await fetch(`${API_BASE_URL}/api/oauth/connections`, {
    credentials: 'include'
  })

  if (!res.ok) {
    throw new Error('Failed to load OAuth connections')
  }

  const data = (await res.json()) as ConnectionsApiResponse
  const map: ProviderConnectionMap = {
    google: defaultProviderConnections(),
    microsoft: defaultProviderConnections()
  }

  const normalize = (value?: string | null): string | undefined => {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const personalEntries = Array.isArray(data.personal) ? data.personal : []
  personalEntries.forEach((entry) => {
    if (
      !entry ||
      (entry.provider !== 'google' && entry.provider !== 'microsoft')
    ) {
      return
    }

    map[entry.provider] = {
      ...map[entry.provider],
      personal: {
        scope: 'personal',
        id: entry.id,
        connected: true,
        accountEmail: normalize(entry.accountEmail),
        expiresAt: entry.expiresAt ?? undefined,
        isShared: Boolean(entry.isShared)
      }
    }
  })

  const workspaceEntries = Array.isArray(data.workspace) ? data.workspace : []
  workspaceEntries.forEach((entry) => {
    if (
      !entry ||
      (entry.provider !== 'google' && entry.provider !== 'microsoft')
    ) {
      return
    }

    const connectionId = entry.id?.trim()
    const workspaceId = entry.workspaceId?.trim()
    if (!connectionId || !workspaceId) {
      return
    }

    const workspaceInfo: WorkspaceConnectionInfo = {
      scope: 'workspace',
      id: connectionId,
      connected: true,
      accountEmail: normalize(entry.accountEmail),
      expiresAt: entry.expiresAt ?? undefined,
      workspaceId,
      workspaceName: normalize(entry.workspaceName) ?? 'Workspace connection',
      sharedByName: normalize(entry.sharedByName),
      sharedByEmail: normalize(entry.sharedByEmail)
    }

    map[entry.provider] = {
      ...map[entry.provider],
      workspace: [...map[entry.provider].workspace, workspaceInfo]
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
): Promise<
  Pick<PersonalConnectionInfo, 'connected' | 'accountEmail' | 'expiresAt'>
> {
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

export async function promoteConnection({
  workspaceId,
  provider,
  connectionId
}: {
  workspaceId: string
  provider: OAuthProvider
  connectionId: string
}): Promise<void> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/connections/promote`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({
        provider,
        connection_id: connectionId
      })
    }
  )

  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => body?.message)
      .catch(() => null)
    throw new Error(message || 'Failed to promote connection')
  }
}

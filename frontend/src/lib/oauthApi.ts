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
  lastRefreshedAt?: string
  requiresReconnect: boolean
}

export interface PersonalConnectionInfo extends BaseConnectionInfo {
  scope: 'personal'
  isShared: boolean
}

export interface WorkspaceConnectionInfo extends BaseConnectionInfo {
  scope: 'workspace'
  provider: OAuthProvider
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

type ConnectionListener = (snapshot: ProviderConnectionMap | null) => void

let cachedConnections: ProviderConnectionMap | null = null
const connectionListeners = new Set<ConnectionListener>()

const cloneConnectionSet = (
  set: ProviderConnectionSet
): ProviderConnectionSet => ({
  personal: { ...set.personal },
  workspace: set.workspace.map((entry) => ({ ...entry }))
})

const cloneConnectionMap = (
  map: ProviderConnectionMap
): ProviderConnectionMap => ({
  google: cloneConnectionSet(map.google),
  microsoft: cloneConnectionSet(map.microsoft)
})

const emitCachedConnections = (snapshot: ProviderConnectionMap | null) => {
  cachedConnections = snapshot ? cloneConnectionMap(snapshot) : null
  const payload = cachedConnections
    ? cloneConnectionMap(cachedConnections)
    : null
  connectionListeners.forEach((listener) => {
    listener(payload)
  })
}

export const getCachedConnections = (): ProviderConnectionMap | null => {
  return cachedConnections ? cloneConnectionMap(cachedConnections) : null
}

export const subscribeToConnectionUpdates = (
  listener: ConnectionListener
): (() => void) => {
  connectionListeners.add(listener)
  if (cachedConnections) {
    listener(cloneConnectionMap(cachedConnections))
  }
  return () => {
    connectionListeners.delete(listener)
  }
}

export const setCachedConnections = (snapshot: ProviderConnectionMap) => {
  emitCachedConnections(snapshot)
}

export const updateCachedConnections = (
  updater: (
    current: ProviderConnectionMap | null
  ) => ProviderConnectionMap | null
): ProviderConnectionMap | null => {
  const current = cachedConnections
    ? cloneConnectionMap(cachedConnections)
    : null
  const next = updater(current)
  emitCachedConnections(next)
  return next
}

interface PersonalConnectionPayload {
  id: string
  provider: OAuthProvider
  accountEmail: string
  expiresAt: string
  isShared: boolean
  lastRefreshedAt?: string | null
  requiresReconnect?: boolean | null
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
  lastRefreshedAt?: string | null
  requiresReconnect?: boolean | null
}

interface ConnectionsApiResponse {
  success: boolean
  personal?: PersonalConnectionPayload[] | null
  workspace?: WorkspaceConnectionPayload[] | null
}

interface RefreshApiResponse {
  success: boolean
  accountEmail?: string | null
  expiresAt?: string | null
  lastRefreshedAt?: string | null
  requiresReconnect?: boolean | null
  requires_reconnect?: boolean | null
  message?: string | null
}

const defaultPersonalConnection = (): PersonalConnectionInfo => ({
  scope: 'personal',
  id: null,
  connected: false,
  accountEmail: undefined,
  expiresAt: undefined,
  lastRefreshedAt: undefined,
  requiresReconnect: false,
  isShared: false
})

const defaultProviderConnections = (): ProviderConnectionSet => ({
  personal: defaultPersonalConnection(),
  workspace: []
})

const ensureConnectionMap = (
  map: ProviderConnectionMap | null
): ProviderConnectionMap =>
  map ?? {
    google: defaultProviderConnections(),
    microsoft: defaultProviderConnections()
  }

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
        connected: !entry.requiresReconnect,
        accountEmail: normalize(entry.accountEmail),
        expiresAt: entry.expiresAt ?? undefined,
        lastRefreshedAt: normalize(entry.lastRefreshedAt),
        requiresReconnect: Boolean(entry.requiresReconnect),
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
      connected: !entry.requiresReconnect,
      provider: entry.provider,
      accountEmail: normalize(entry.accountEmail),
      expiresAt: entry.expiresAt ?? undefined,
      lastRefreshedAt: normalize(entry.lastRefreshedAt),
      workspaceId,
      workspaceName: normalize(entry.workspaceName) ?? 'Workspace connection',
      sharedByName: normalize(entry.sharedByName),
      sharedByEmail: normalize(entry.sharedByEmail),
      requiresReconnect: Boolean(entry.requiresReconnect)
    }

    map[entry.provider] = {
      ...map[entry.provider],
      workspace: [...map[entry.provider].workspace, workspaceInfo]
    }
  })

  setCachedConnections(map)
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

export async function unshareWorkspaceConnection(
  workspaceId: string,
  connectionId: string
): Promise<void> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/connections/${connectionId}`,
    {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'x-csrf-token': csrfToken
      }
    }
  )

  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => body?.message)
      .catch(() => null)
    throw new Error(message || 'Failed to remove workspace connection')
  }
}

export async function refreshProvider(
  provider: OAuthProvider
): Promise<
  Pick<
    PersonalConnectionInfo,
    'connected' | 'accountEmail' | 'expiresAt' | 'lastRefreshedAt'
  >
> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/oauth/${provider}/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-csrf-token': csrfToken
    }
  })

  const data = (await res.json().catch(() => null)) as RefreshApiResponse | null

  const requiresReconnect = Boolean(
    data?.requiresReconnect ?? data?.requires_reconnect
  )

  if (requiresReconnect) {
    markProviderRevoked(provider)
    const error: Error & { requiresReconnect?: boolean } = new Error(
      data?.message || 'The connection was revoked. Reconnect to continue.'
    )
    error.requiresReconnect = true
    throw error
  }

  if (!res.ok) {
    throw new Error(data?.message || 'Failed to refresh provider tokens')
  }

  const normalize = (value?: string | null): string | undefined => {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  return {
    connected: true,
    accountEmail: normalize(data?.accountEmail),
    expiresAt: normalize(data?.expiresAt),
    lastRefreshedAt: normalize(data?.lastRefreshedAt)
  }
}

export const clearProviderConnections = (provider: OAuthProvider) => {
  updateCachedConnections((current) => {
    const map = ensureConnectionMap(current)
    return {
      ...map,
      [provider]: defaultProviderConnections()
    }
  })
}

export const markProviderRevoked = (provider: OAuthProvider) => {
  updateCachedConnections((current) => {
    const map = ensureConnectionMap(current)
    const personal = defaultPersonalConnection()
    personal.requiresReconnect = true
    return {
      ...map,
      [provider]: {
        personal,
        workspace: []
      }
    }
  })
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

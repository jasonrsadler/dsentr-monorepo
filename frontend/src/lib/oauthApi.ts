import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'
import { useAuth } from '@/stores/auth'

export type OAuthProvider = 'google' | 'microsoft' | 'slack' | 'asana'

export type ConnectionScope = 'personal' | 'workspace'

export interface BaseConnectionInfo {
  scope: ConnectionScope
  id: string | null
  connectionId?: string
  connected: boolean
  accountEmail?: string
  expiresAt?: string
  lastRefreshedAt?: string
  requiresReconnect: boolean
}

export interface PersonalConnectionInfo extends BaseConnectionInfo {
  scope: 'personal'
  isShared: boolean
  ownerUserId?: string
  ownerName?: string
  ownerEmail?: string
}

export interface WorkspaceConnectionInfo extends BaseConnectionInfo {
  scope: 'workspace'
  provider: OAuthProvider
  workspaceId: string
  workspaceName: string
  workspaceConnectionId?: string
  sharedByName?: string
  sharedByEmail?: string
  ownerUserId?: string
  hasIncomingWebhook?: boolean
}

export interface ProviderConnectionSet {
  personal: PersonalConnectionInfo
  workspace: WorkspaceConnectionInfo[]
}

// Grouped snapshot shape as returned by the API (no regrouping by provider)
export interface PersonalConnectionRecord extends PersonalConnectionInfo {
  provider: OAuthProvider
}

export interface GroupedConnectionsSnapshot {
  personal: PersonalConnectionRecord[]
  workspace: WorkspaceConnectionInfo[]
}

const PROVIDER_KEYS: OAuthProvider[] = ['google', 'microsoft', 'slack', 'asana']

const resolveApiBaseUrl = (): string => {
  const rawBase =
    typeof API_BASE_URL === 'string' && API_BASE_URL.trim().length > 0
      ? API_BASE_URL.trim()
      : typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost'

  return rawBase.replace(/\/$/, '')
}

const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(normalizedPath, resolveApiBaseUrl()).toString()
}

type ConnectionListener = (snapshot: GroupedConnectionsSnapshot | null) => void
type RawConnectionListener = (
  snapshot: GroupedConnectionsSnapshot | null,
  workspaceId: string | null
) => void

let cachedConnections: GroupedConnectionsSnapshot | null = null
let cachedWorkspaceId: string | null = null
const connectionListeners = new Set<RawConnectionListener>()

type ConnectionCacheOptions = {
  workspaceId?: string | null
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

const cloneGroupedSnapshot = (
  snapshot: GroupedConnectionsSnapshot
): GroupedConnectionsSnapshot => ({
  personal: snapshot.personal.map((p) => ({ ...p })),
  workspace: snapshot.workspace.map((w) => ({ ...w }))
})

const normalizeWorkspaceId = (value?: string | null): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const readActiveWorkspaceId = (): string | null => {
  try {
    const state = useAuth.getState()
    return normalizeWorkspaceId(state?.currentWorkspaceId ?? null)
  } catch {
    return null
  }
}

const resolveWorkspaceId = (workspaceId?: string | null): string | null => {
  if (typeof workspaceId !== 'undefined') {
    return normalizeWorkspaceId(workspaceId)
  }
  const activeWorkspace = readActiveWorkspaceId()
  if (activeWorkspace !== null) {
    return activeWorkspace
  }
  return cachedWorkspaceId
}

const emitCachedConnections = (
  snapshot: GroupedConnectionsSnapshot | null,
  options?: ConnectionCacheOptions
) => {
  if (options && Object.prototype.hasOwnProperty.call(options, 'workspaceId')) {
    cachedWorkspaceId = normalizeWorkspaceId(options.workspaceId ?? null)
  }
  if (!options && cachedWorkspaceId === null) {
    cachedWorkspaceId = readActiveWorkspaceId()
  }

  cachedConnections = snapshot ? cloneGroupedSnapshot(snapshot) : null
  const workspaceId = cachedWorkspaceId
  connectionListeners.forEach((listener) => {
    const payload = cachedConnections
      ? cloneGroupedSnapshot(cachedConnections)
      : null
    listener(payload, workspaceId)
  })
}

export const getCachedConnections = (
  workspaceId?: string | null
): GroupedConnectionsSnapshot | null => {
  const targetWorkspace = resolveWorkspaceId(workspaceId)
  if (!cachedConnections || cachedWorkspaceId !== targetWorkspace) {
    return null
  }
  return cloneGroupedSnapshot(cachedConnections)
}

export const subscribeToConnectionUpdates = (
  listener: ConnectionListener,
  options?: ConnectionCacheOptions
): (() => void) => {
  const targetWorkspace = resolveWorkspaceId(options?.workspaceId)

  const wrappedListener: RawConnectionListener = (snapshot, workspaceId) => {
    if (workspaceId !== targetWorkspace) {
      listener(null)
      return
    }
    listener(snapshot ? cloneGroupedSnapshot(snapshot) : null)
  }

  connectionListeners.add(wrappedListener)

  if (cachedConnections && cachedWorkspaceId === targetWorkspace) {
    listener(cloneGroupedSnapshot(cachedConnections))
  } else {
    listener(null)
  }

  return () => {
    connectionListeners.delete(wrappedListener)
  }
}

export const setCachedConnections = (
  snapshot: GroupedConnectionsSnapshot,
  options?: ConnectionCacheOptions
) => {
  emitCachedConnections(snapshot, options)
}

export const updateCachedConnections = (
  updater: (
    current: GroupedConnectionsSnapshot | null
  ) => GroupedConnectionsSnapshot | null,
  options?: ConnectionCacheOptions
): GroupedConnectionsSnapshot | null => {
  const current = cachedConnections
    ? cloneGroupedSnapshot(cachedConnections)
    : null
  const next = updater(current)
  emitCachedConnections(next, options)
  return next
}

interface ConnectionOwnerPayload {
  userId?: string | null
  name?: string | null
  email?: string | null
}

interface PersonalConnectionPayload {
  id: string
  connection_id?: string | null
  connectionId?: string | null
  provider: OAuthProvider
  accountEmail: string
  expiresAt: string
  isShared: boolean
  lastRefreshedAt?: string | null
  requiresReconnect?: boolean | null
  requires_reconnect?: boolean | null
  connected?: boolean | null
  owner?: ConnectionOwnerPayload | null
}

interface WorkspaceConnectionPayload {
  id: string
  connection_id?: string | null
  connectionId?: string | null
  workspace_connection_id?: string | null
  workspaceConnectionId?: string | null
  provider: OAuthProvider
  accountEmail: string
  expiresAt: string
  workspaceId: string
  workspaceName: string
  sharedByName?: string | null
  sharedByEmail?: string | null
  lastRefreshedAt?: string | null
  requiresReconnect?: boolean | null
  requires_reconnect?: boolean | null
  connected?: boolean | null
  owner?: ConnectionOwnerPayload | null
  hasIncomingWebhook?: boolean | null
  has_incoming_webhook?: boolean | null
}

type ProviderConnectionBuckets<T> = Partial<Record<OAuthProvider, T[] | null>>

interface ConnectionsApiResponse {
  success: boolean
  personal?:
    | ProviderConnectionBuckets<PersonalConnectionPayload>
    | PersonalConnectionPayload[]
    | null
  workspace?:
    | ProviderConnectionBuckets<WorkspaceConnectionPayload>
    | WorkspaceConnectionPayload[]
    | null
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

const resolveBucketEntries = <T extends { provider: OAuthProvider }>(
  bucket: ProviderConnectionBuckets<T> | T[] | null | undefined,
  provider: OAuthProvider
): T[] => {
  if (!bucket) {
    return []
  }

  if (Array.isArray(bucket)) {
    return bucket.filter(
      (entry) => !!entry && entry.provider === provider
    ) as T[]
  }

  const entries = bucket[provider]
  return Array.isArray(entries) ? (entries as T[]).filter(Boolean) : []
}

const ensureGrouped = (
  snapshot: GroupedConnectionsSnapshot | null
): GroupedConnectionsSnapshot => ({
  personal: Array.isArray(snapshot?.personal)
    ? snapshot!.personal.map((p) => ({ ...p }))
    : [],
  workspace: Array.isArray(snapshot?.workspace)
    ? snapshot!.workspace.map((w) => ({ ...w }))
    : []
})

export async function fetchConnections(
  options?: ConnectionCacheOptions
): Promise<GroupedConnectionsSnapshot> {
  const targetWorkspace = resolveWorkspaceId(options?.workspaceId)
  const url = new URL('/api/oauth/connections', resolveApiBaseUrl())
  url.searchParams.set('workspace', targetWorkspace as string)
  const res = await fetch(url.toString(), {
    credentials: 'include'
  })

  if (!res.ok) {
    throw new Error('Failed to load OAuth connections')
  }

  const data = (await res.json()) as ConnectionsApiResponse
  const grouped: GroupedConnectionsSnapshot = {
    personal: [],
    workspace: []
  }

  const normalize = (value?: string | null): string | undefined => {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  const normalizeId = (value?: string | null): string | undefined => {
    return normalize(value)
  }
  const resolveConnectionId = (entry?: {
    id?: string | null
    connection_id?: string | null
    connectionId?: string | null
  }): string | undefined => {
    if (!entry) return undefined
    return normalizeId(
      entry.connectionId ?? entry.connection_id ?? entry.id ?? null
    )
  }

  const resolveWorkspaceConnectionId = (entry?: {
    id?: string | null
    workspace_connection_id?: string | null
    workspaceConnectionId?: string | null
  }): string | undefined => {
    if (!entry) return undefined
    return normalizeId(
      entry.workspaceConnectionId ??
        entry.workspace_connection_id ??
        entry.id ??
        null
    )
  }

  const personalBuckets = data.personal
  PROVIDER_KEYS.forEach((provider) => {
    const entries = resolveBucketEntries(personalBuckets, provider)
    entries.forEach((entry) => {
      if (!entry) {
        return
      }
      const requiresReconnect = Boolean(
        entry.requiresReconnect ?? entry.requires_reconnect
      )
      const connectionId =
        resolveConnectionId(entry) ?? resolveWorkspaceConnectionId(entry)
      const connected =
        typeof entry.connected === 'boolean'
          ? entry.connected
          : !requiresReconnect
      grouped.personal.push({
        scope: 'personal',
        provider,
        id: connectionId ?? entry.id ?? null,
        connectionId: connectionId,
        connected,
        accountEmail: normalize(entry.accountEmail),
        expiresAt: entry.expiresAt ?? undefined,
        lastRefreshedAt: normalize(entry.lastRefreshedAt),
        requiresReconnect,
        isShared: Boolean(entry.isShared),
        ownerUserId: normalizeId(entry.owner?.userId),
        ownerName: normalize(entry.owner?.name),
        ownerEmail: normalize(entry.owner?.email)
      })
    })
  })

  const workspaceBuckets = data.workspace
  PROVIDER_KEYS.forEach((provider) => {
    const entries = resolveBucketEntries(workspaceBuckets, provider)
    entries.forEach((entry) => {
      if (!entry) {
        return
      }

      const connectionId = resolveConnectionId(entry)
      const workspaceConnectionId =
        resolveWorkspaceConnectionId(entry) ?? connectionId
      const workspaceId = entry.workspaceId?.trim()
      if (!workspaceConnectionId || !workspaceId) {
        return
      }

      const requiresReconnect = Boolean(
        entry.requiresReconnect ?? entry.requires_reconnect
      )
      const connected =
        typeof entry.connected === 'boolean'
          ? entry.connected
          : !requiresReconnect

      const ownerName =
        normalize(entry.sharedByName) ?? normalize(entry.owner?.name)
      const ownerEmail =
        normalize(entry.sharedByEmail) ?? normalize(entry.owner?.email)

      const workspaceInfo: WorkspaceConnectionInfo = {
        scope: 'workspace',
        id: workspaceConnectionId,
        workspaceConnectionId,
        connectionId: connectionId ?? workspaceConnectionId,
        connected,
        provider,
        accountEmail: normalize(entry.accountEmail),
        expiresAt: entry.expiresAt ?? undefined,
        lastRefreshedAt: normalize(entry.lastRefreshedAt),
        workspaceId,
        workspaceName: normalize(entry.workspaceName) ?? 'Workspace connection',
        sharedByName: ownerName,
        sharedByEmail: ownerEmail,
        requiresReconnect,
        ownerUserId: normalizeId(entry.owner?.userId),
        hasIncomingWebhook: Boolean(
          entry.hasIncomingWebhook ?? entry.has_incoming_webhook
        )
      }

      grouped.workspace.push(workspaceInfo)
    })
  })

  setCachedConnections(grouped, { workspaceId: targetWorkspace })
  return grouped
}

export async function disconnectProvider(
  provider: OAuthProvider,
  connectionId?: string | null
): Promise<void> {
  const csrfToken = await getCsrfToken()
  const url = new URL(buildApiUrl(`/api/oauth/${provider}/disconnect`))
  if (connectionId) {
    url.searchParams.set('connection', connectionId)
  }
  const res = await fetch(url.toString(), {
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
    buildApiUrl(`/api/workspaces/${workspaceId}/connections/${connectionId}`),
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
  provider: OAuthProvider,
  connectionId?: string | null
): Promise<
  Pick<
    PersonalConnectionInfo,
    'connected' | 'accountEmail' | 'expiresAt' | 'lastRefreshedAt'
  >
> {
  const csrfToken = await getCsrfToken()
  const url = new URL(buildApiUrl(`/api/oauth/${provider}/refresh`))
  if (connectionId) {
    url.searchParams.set('connection', connectionId)
  }
  const res = await fetch(url.toString(), {
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
    markProviderRevoked(provider, connectionId)
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
    const snapshot = ensureGrouped(current)
    const nextPersonal = snapshot.personal.filter(
      (p) => p.provider !== provider
    )
    const nextWorkspace = snapshot.workspace.filter(
      (w) => w.provider !== provider
    )
    return { personal: nextPersonal, workspace: nextWorkspace }
  })
}

export const markProviderRevoked = (
  provider: OAuthProvider,
  connectionId?: string | null
) => {
  const normalize = (value?: string | null): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  const targetConnection = normalize(connectionId)
  updateCachedConnections((current) => {
    const snapshot = ensureGrouped(current)
    let found = false
    const nextPersonal = snapshot.personal.map((p) => {
      if (p.provider !== provider) return { ...p }
      const connectionKey =
        normalize(p.connectionId) ?? normalize(p.id) ?? undefined
      if (targetConnection && connectionKey !== targetConnection) {
        return { ...p }
      }
      found = true
      return {
        ...p,
        connected: false,
        requiresReconnect: true,
        id: p.id ?? null,
        connectionId: p.connectionId ?? p.id ?? undefined
      }
    })
    // If no personal record exists for the provider, add a revoked placeholder
    if (!found) {
      nextPersonal.push({
        provider,
        ...defaultPersonalConnection(),
        connectionId: targetConnection ?? undefined,
        id: targetConnection ?? null,
        requiresReconnect: true
      })
    }
    const nextWorkspace = snapshot.workspace.filter((w) => {
      if (w.provider !== provider) return true
      if (!targetConnection) {
        return false
      }
      const workspaceKey =
        normalize(w.connectionId) ?? normalize(w.id) ?? undefined
      return workspaceKey !== targetConnection
    })
    return { personal: nextPersonal, workspace: nextWorkspace }
  })
}

interface PromoteConnectionResponse {
  success?: boolean
  workspace_connection_id?: string | null
  workspaceConnectionId?: string | null
  created_by?: string | null
  createdBy?: string | null
  message?: string | null
}

export interface PromoteConnectionResult {
  workspaceConnectionId: string
  createdBy?: string
}

export async function promoteConnection({
  workspaceId,
  provider,
  connectionId
}: {
  workspaceId: string
  provider: OAuthProvider
  connectionId: string
}): Promise<PromoteConnectionResult> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(
    buildApiUrl(`/api/workspaces/${workspaceId}/connections/promote`),
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

  const data = (await res
    .json()
    .catch(() => null)) as PromoteConnectionResponse | null

  const normalizeId = (value?: string | null): string | null => {
    if (typeof value !== 'string') {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const workspaceConnectionId =
    normalizeId(data?.workspace_connection_id) ??
    normalizeId(data?.workspaceConnectionId ?? null)

  if (!res.ok || !workspaceConnectionId) {
    const message = typeof data?.message === 'string' ? data?.message : null
    throw new Error(message || 'Failed to promote connection')
  }

  const createdBy =
    normalizeId(data?.created_by) ??
    normalizeId(data?.createdBy ?? null) ??
    undefined

  return {
    workspaceConnectionId,
    createdBy
  }
}

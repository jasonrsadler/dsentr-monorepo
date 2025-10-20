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

interface RawPersonalConnection {
  id?: string | null
  connected?: boolean
  account_email?: string | null
  expires_at?: string | null
  is_shared?: boolean
}

interface RawWorkspaceConnection {
  id?: string | null
  account_email?: string | null
  expires_at?: string | null
  workspace_id?: string | null
  workspace_name?: string | null
  shared_by_name?: string | null
  shared_by_email?: string | null
  shared_by?: {
    name?: string | null
    email?: string | null
  } | null
}

interface RawProviderConnections {
  personal?: RawPersonalConnection | null
  workspace?: RawWorkspaceConnection[] | null
}

interface ConnectionsApiResponse {
  success: boolean
  providers: Record<string, RawProviderConnections>
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

const mapPersonalConnection = (
  raw?: RawPersonalConnection | null
): PersonalConnectionInfo => {
  if (!raw) return defaultPersonalConnection()
  return {
    scope: 'personal',
    id: typeof raw.id === 'string' && raw.id ? raw.id : null,
    connected: Boolean(raw.connected),
    accountEmail: raw.account_email ?? undefined,
    expiresAt: raw.expires_at ?? undefined,
    isShared: Boolean(raw.is_shared)
  }
}

const mapWorkspaceConnection = (
  raw: RawWorkspaceConnection | null | undefined
): WorkspaceConnectionInfo | null => {
  if (!raw) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id : null
  const workspaceId =
    typeof raw.workspace_id === 'string' && raw.workspace_id
      ? raw.workspace_id
      : null
  if (!id || !workspaceId) return null

  const sharedByName = raw.shared_by_name ?? raw.shared_by?.name ?? undefined
  const sharedByEmail = raw.shared_by_email ?? raw.shared_by?.email ?? undefined

  return {
    scope: 'workspace',
    id,
    connected: true,
    accountEmail: raw.account_email ?? undefined,
    expiresAt: raw.expires_at ?? undefined,
    workspaceId,
    workspaceName: raw.workspace_name ?? 'Workspace connection',
    sharedByName,
    sharedByEmail
  }
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

  Object.entries(data.providers || {}).forEach(([key, value]) => {
    if (key === 'google' || key === 'microsoft') {
      const personal = mapPersonalConnection(value?.personal)
      const workspace = Array.isArray(value?.workspace)
        ? value!
            .workspace!.map((entry) => mapWorkspaceConnection(entry))
            .filter((entry): entry is WorkspaceConnectionInfo => entry !== null)
        : []

      map[key] = {
        personal,
        workspace
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

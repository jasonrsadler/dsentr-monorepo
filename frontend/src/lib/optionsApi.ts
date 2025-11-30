import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export interface SecretEntry {
  value: string
  ownerId: string
}

export type SecretStore = Record<
  string,
  Record<string, Record<string, SecretEntry>>
>

interface SecretsResponse {
  success: boolean
  secrets: SecretStore
  outcome?: 'created' | 'updated' | 'unchanged'
}

interface WorkspaceSecretsResponse {
  success: boolean
  ownership: WorkspaceSecretOwnership
}

export interface WorkspaceSecretOwnershipEntry {
  group: string
  service: string
  name: string
}

export type WorkspaceSecretOwnership = Record<
  string,
  WorkspaceSecretOwnershipEntry[]
>

function normalizeSecretStore(raw: unknown): SecretStore {
  if (!raw || typeof raw !== 'object') {
    return {}
  }

  const normalized: SecretStore = {}

  Object.entries(raw as Record<string, unknown>).forEach(
    ([groupKey, services]) => {
      if (!services || typeof services !== 'object') {
        return
      }

      const normalizedServices: Record<string, Record<string, SecretEntry>> = {}

      Object.entries(services as Record<string, unknown>).forEach(
        ([serviceKey, entries]) => {
          if (!entries || typeof entries !== 'object') {
            return
          }

          const normalizedEntries: Record<string, SecretEntry> = {}

          Object.entries(entries as Record<string, unknown>).forEach(
            ([name, entry]) => {
              if (entry && typeof entry === 'object') {
                const value =
                  typeof (entry as { value?: unknown }).value === 'string'
                    ? (entry as { value: string }).value
                    : ''

                let ownerId = ''
                if (
                  typeof (entry as { ownerId?: unknown }).ownerId === 'string'
                ) {
                  ownerId = (entry as { ownerId: string }).ownerId
                } else if (
                  typeof (entry as { owner_id?: unknown }).owner_id === 'string'
                ) {
                  ownerId = (entry as { owner_id: string }).owner_id
                }

                normalizedEntries[name] = { value, ownerId }
              } else if (typeof entry === 'string') {
                normalizedEntries[name] = { value: entry, ownerId: '' }
              }
            }
          )

          normalizedServices[serviceKey] = normalizedEntries
        }
      )

      normalized[groupKey] = normalizedServices
    }
  )

  return normalized
}

async function handleResponse(res: Response): Promise<SecretsResponse> {
  const data = await res
    .json()
    .catch(() => ({ success: false, message: 'Invalid response' }))
  if (!res.ok || !data.success) {
    throw new Error(data?.message || 'Request failed')
  }

  const normalizedSecrets = normalizeSecretStore(
    (data as { secrets?: unknown }).secrets
  )

  return {
    ...(data as SecretsResponse),
    secrets: normalizedSecrets
  }
}

function buildWorkspaceQuery(workspaceId?: string | null) {
  return workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ''
}

function parseRunawayProtectionSetting(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : true
}

export async function fetchSecrets(
  workspaceId?: string | null
): Promise<SecretStore> {
  const res = await fetch(
    `${API_BASE_URL}/api/options/secrets${buildWorkspaceQuery(workspaceId)}`,
    {
      credentials: 'include'
    }
  )

  const data = await handleResponse(res)
  return data.secrets ?? {}
}

export async function upsertSecret(
  group: string,
  service: string,
  name: string,
  value: string,
  workspaceId?: string | null
): Promise<SecretsResponse> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/options/secrets/${encodeURIComponent(group)}/${encodeURIComponent(service)}/${encodeURIComponent(name)}${buildWorkspaceQuery(workspaceId)}`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({ value })
    }
  )

  return handleResponse(res)
}

export async function deleteSecret(
  group: string,
  service: string,
  name: string,
  workspaceId?: string | null
): Promise<SecretsResponse> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/options/secrets/${encodeURIComponent(group)}/${encodeURIComponent(service)}/${encodeURIComponent(name)}${buildWorkspaceQuery(workspaceId)}`,
    {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'x-csrf-token': csrfToken
      }
    }
  )

  return handleResponse(res)
}

export async function fetchWorkspaceSecretOwnership(
  workspaceId: string
): Promise<WorkspaceSecretOwnership> {
  const res = await fetch(
    `${API_BASE_URL}/api/workspaces/${workspaceId}/secrets`,
    {
      credentials: 'include'
    }
  )

  const data = (await res
    .json()
    .catch(() => ({ success: false, message: 'Invalid response' }))) as
    | WorkspaceSecretsResponse
    | { success: false; message?: string }

  if (!res.ok || !data.success) {
    const message =
      'message' in data && typeof (data as any).message === 'string'
        ? (data as any).message
        : undefined
    throw new Error(message || 'Failed to load workspace secrets')
  }

  return data.ownership ?? {}
}

export async function fetchRunawayProtectionSetting(
  workspaceId?: string | null
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE_URL}/api/options/user-settings${buildWorkspaceQuery(workspaceId)}`,
    {
      credentials: 'include'
    }
  )

  const data = (await res
    .json()
    .catch(() => ({ success: false, message: 'Invalid response' }))) as {
    success?: boolean
    message?: string
    settings?: { workflows?: { runaway_protection_enabled?: boolean } }
  }

  if (!res.ok || data.success === false) {
    throw new Error(data.message || 'Failed to load settings')
  }

  return parseRunawayProtectionSetting(
    data.settings?.workflows?.runaway_protection_enabled
  )
}

export async function updateRunawayProtectionSetting(
  workspaceId: string,
  enabled: boolean
): Promise<boolean> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/options/user-settings`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      runaway_protection_enabled: enabled
    })
  })

  const data = (await res
    .json()
    .catch(() => ({ success: false, message: 'Invalid response' }))) as {
    success?: boolean
    message?: string
    settings?: { workflows?: { runaway_protection_enabled?: boolean } }
  }

  if (!res.ok || data.success === false) {
    throw new Error(data.message || 'Failed to update settings')
  }

  return parseRunawayProtectionSetting(
    data.settings?.workflows?.runaway_protection_enabled
  )
}

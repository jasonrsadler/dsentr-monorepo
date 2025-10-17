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

async function handleResponse(res: Response): Promise<SecretsResponse> {
  const data = await res
    .json()
    .catch(() => ({ success: false, message: 'Invalid response' }))
  if (!res.ok || !data.success) {
    throw new Error(data?.message || 'Request failed')
  }
  return data as SecretsResponse
}

export async function fetchSecrets(): Promise<SecretStore> {
  const res = await fetch(`${API_BASE_URL}/api/options/secrets`, {
    credentials: 'include'
  })

  const data = await handleResponse(res)
  return data.secrets ?? {}
}

export async function upsertSecret(
  group: string,
  service: string,
  name: string,
  value: string
): Promise<SecretsResponse> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/options/secrets/${encodeURIComponent(group)}/${encodeURIComponent(service)}/${encodeURIComponent(name)}`,
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
  name: string
): Promise<SecretsResponse> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(
    `${API_BASE_URL}/api/options/secrets/${encodeURIComponent(group)}/${encodeURIComponent(service)}/${encodeURIComponent(name)}`,
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
    throw new Error(data?.message || 'Failed to load workspace secrets')
  }

  return data.ownership ?? {}
}

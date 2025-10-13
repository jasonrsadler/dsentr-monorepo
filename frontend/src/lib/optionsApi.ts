import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export type SecretStore = Record<string, Record<string, Record<string, string>>>

interface SecretsResponse {
  success: boolean
  secrets: SecretStore
  outcome?: 'created' | 'updated' | 'unchanged'
}

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

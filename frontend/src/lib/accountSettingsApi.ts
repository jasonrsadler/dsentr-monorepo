import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'
import { errorMessage } from './errorMessage'

export type PrivacyPreference = {
  allow: boolean
}

export async function getPrivacyPreference(): Promise<PrivacyPreference> {
  const res = await fetch(`${API_BASE_URL}/api/account/privacy`, {
    method: 'GET',
    credentials: 'include'
  })
  if (!res.ok) {
    // Default to allow=true if API fails — UI can still render
    return { allow: true }
  }
  const data = (await res.json()) as { allow?: boolean }
  return { allow: data?.allow ?? true }
}

export async function setPrivacyPreference(allow: boolean): Promise<void> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/account/privacy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify({ allow })
  })
  if (!res.ok) {
    let message = 'Failed to update preference'
    try {
      const data = await res.json()
      if (data && typeof data.message === 'string') message = data.message
    } catch (err) {
      console.error(errorMessage(err))
    }
    throw new Error(message)
  }
}

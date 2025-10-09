import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export async function verifyEmail(token: string | null) {
  if (!token) {
    return { success: false, message: 'Missing token' }
  }

  try {
    const csrfToken = await getCsrfToken()
    const res = await fetch(`${API_BASE_URL}/api/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({ token }),
      credentials: 'include'
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      return {
        success: false,
        message: data?.message || 'Verification failed'
      }
    }

    return { success: true }
  } catch (err: any) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Unexpected error occurred'
    }
  }
}

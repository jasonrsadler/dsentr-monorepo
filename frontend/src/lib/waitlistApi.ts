import { API_BASE_URL } from './config'

export async function joinWaitlist(email: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/early-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    const data = await res.json()

    if (res.status === 409) {
      throw new Error(data.message || 'Email already exists')
    }

    if (res.ok && data.status === 'success') {
      return data.message // "Thanks for signing up!"
    } else {
      throw new Error(data.message || 'Failed to join the waitlist')
    }
  } catch (error: any) {
    console.error('An error occurred joining waitlist:', error)

    // Preserve backend's specific 409 message if available
    if (
      error instanceof Error &&
      error.message.toLocaleLowerCase().includes('already on the list')
    ) {
      throw error
    }

    throw new Error(
      'An error occurred while joining the waitlist. Please try again later.'
    )
  }
}

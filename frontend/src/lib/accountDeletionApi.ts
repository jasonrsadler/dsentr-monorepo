import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export type AccountDeletionRequestPayload = {
  email: string
  password?: string
}

export type AccountDeletionSummary = {
  success: boolean
  email: string
  requested_at: string
  expires_at: string
  requires_password: boolean
  oauth_provider?: string | null
  counts: {
    workflows: number
    owned_workspaces: number
    member_workspaces: number
    workflow_runs: number
    workflow_logs: number
    oauth_connections: number
    pending_invitations: number
    secrets: number
  }
  stripe: {
    has_customer: boolean
    has_active_subscription: boolean
  }
  additional_data: string[]
  system_impacts: string[]
  compliance_notice: string
}

async function handleJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.success === false) {
    const message = data?.message || 'Request failed'
    throw new Error(message)
  }
  return data
}

export async function requestAccountDeletion(
  payload: AccountDeletionRequestPayload
) {
  const csrfToken = await getCsrfToken()
  const response = await fetch(`${API_BASE_URL}/api/account/delete/request`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify(payload)
  })

  return handleJsonResponse(response)
}

export async function getAccountDeletionSummary(
  token: string
): Promise<AccountDeletionSummary> {
  const response = await fetch(
    `${API_BASE_URL}/api/account/delete/summary/${encodeURIComponent(token)}`,
    {
      credentials: 'include'
    }
  )

  return handleJsonResponse(response)
}

export async function confirmAccountDeletion(
  payload: AccountDeletionConfirmPayload
) {
  const csrfToken = await getCsrfToken()
  const response = await fetch(`${API_BASE_URL}/api/account/delete/confirm`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    body: JSON.stringify(payload)
  })

  return handleJsonResponse(response)
}

export type AccountDeletionConfirmPayload = {
  token: string
  email: string
  password?: string
}

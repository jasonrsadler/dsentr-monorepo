import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export type IssueThread = {
  id: string
  status: string
  workspace_id?: string | null
  workspace_name?: string | null
  updated_at: string
  unread_admin_messages: number
  last_message_body?: string | null
  last_message_sender?: string | null
  last_message_at?: string | null
}

export type IssueMessage = {
  id: string
  issue_id: string
  sender_id?: string | null
  sender_type: 'user' | 'admin'
  body: string
  created_at: string
  read_by_user_at?: string | null
  read_by_admin_at?: string | null
}

export type IssueReport = {
  id: string
  workspace_id?: string | null
  user_email: string
  user_name: string
  status: string
  created_at: string
  updated_at: string
  workspace_plan?: string | null
  workspace_role?: string | null
}

export type IssueListResponse = {
  issues: IssueThread[]
  unread_admin_messages: number
}

export type IssueDetail = {
  issue: IssueReport
  workspace_name?: string | null
  messages: IssueMessage[]
  unread_admin_messages: number
}

async function parseJson(response: Response) {
  let body: any = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return body
}

export async function fetchIssueThreads(): Promise<IssueListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/issues`, {
    credentials: 'include'
  })

  const body = await parseJson(response)
  if (!response.ok || body?.success === false) {
    const message = body?.message || 'Unable to load messages.'
    throw new Error(message)
  }

  return body as IssueListResponse
}

export async function fetchIssueDetail(issueId: string): Promise<IssueDetail> {
  const response = await fetch(`${API_BASE_URL}/api/issues/${issueId}`, {
    credentials: 'include'
  })

  const body = await parseJson(response)
  if (!response.ok || body?.success === false) {
    const message = body?.message || 'Unable to load this conversation.'
    throw new Error(message)
  }

  return body as IssueDetail
}

export async function markIssueRead(
  issueId: string
): Promise<{ success: boolean; unread_admin_messages: number }> {
  const csrf = await getCsrfToken()
  const response = await fetch(`${API_BASE_URL}/api/issues/${issueId}/read`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrf
    }
  })

  const body = await parseJson(response)
  if (!response.ok || body?.success === false) {
    const message = body?.message || 'Unable to mark this conversation as read.'
    throw new Error(message)
  }

  return body
}

export async function replyToIssueThread(
  issueId: string,
  message: string
): Promise<IssueDetail> {
  const csrf = await getCsrfToken()
  const response = await fetch(`${API_BASE_URL}/api/issues/${issueId}/reply`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrf
    },
    body: JSON.stringify({ message })
  })

  const body = await parseJson(response)
  if (!response.ok || body?.success === false) {
    const errorMessage =
      body?.message || 'Unable to send your reply. Please try again.'
    throw new Error(errorMessage)
  }

  return body as IssueDetail
}

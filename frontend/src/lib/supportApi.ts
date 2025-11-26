import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

type IssueReportPayload = {
  description: string
  workspaceId?: string | null
}

export async function submitIssueReport(payload: IssueReportPayload) {
  const csrf = await getCsrfToken()
  const response = await fetch(`${API_BASE_URL}/api/issues`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrf
    },
    body: JSON.stringify({
      description: payload.description,
      workspace_id: payload.workspaceId ?? null
    })
  })

  let body: any = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok || body?.success === false) {
    const message =
      body?.message ||
      'We could not send your report right now. Please try again.'
    throw new Error(message)
  }

  return body
}

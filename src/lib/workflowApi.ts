import { API_BASE_URL } from './config'
import { getCsrfToken } from './csrfCache'

export interface WorkflowRecord {
  id: string
  name: string
  description: string | null
  data: any
  user_id?: string
  created_at?: string
  updated_at?: string
}

export interface WorkflowPayload {
  name: string
  description: string | null
  data: Record<string, any>
}

async function handleJsonResponse(response: Response) {
  let body: any = null

  try {
    body = await response.json()
  } catch (error) {
    // ignore JSON parse errors and fall through
  }

  if (!response.ok || (body && body.success === false)) {
    const message = body?.message || response.statusText || 'Request failed'
    throw new Error(message)
  }

  return body
}

export async function listWorkflows(): Promise<WorkflowRecord[]> {
  const res = await fetch(`${API_BASE_URL}/api/workflows`, {
    credentials: 'include'
  })

  const data = await handleJsonResponse(res)
  return data.workflows ?? []
}

export async function getWorkflow(id: string): Promise<WorkflowRecord> {
  const res = await fetch(`${API_BASE_URL}/api/workflows/${id}`, {
    credentials: 'include'
  })

  const data = await handleJsonResponse(res)
  return data.workflow
}

export async function createWorkflow(payload: WorkflowPayload): Promise<WorkflowRecord> {
  const csrfToken = await getCsrfToken()

  const res = await fetch(`${API_BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify(payload)
  })

  const data = await handleJsonResponse(res)
  return data.workflow
}

export async function updateWorkflow(id: string, payload: WorkflowPayload): Promise<WorkflowRecord> {
  const csrfToken = await getCsrfToken()

  const res = await fetch(`${API_BASE_URL}/api/workflows/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify(payload)
  })

  const data = await handleJsonResponse(res)
  return data.workflow
}

export async function deleteWorkflow(id: string): Promise<{ success: boolean }> {
  const csrfToken = await getCsrfToken()

  const res = await fetch(`${API_BASE_URL}/api/workflows/${id}`, {
    method: 'DELETE',
    headers: {
      'x-csrf-token': csrfToken,
    },
    credentials: 'include',
  })

  const data = await handleJsonResponse(res)
  return { success: Boolean(data?.success ?? true) }
}

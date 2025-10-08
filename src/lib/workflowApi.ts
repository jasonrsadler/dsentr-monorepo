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

export interface WorkflowLogEntry {
  id: string
  workflow_id: string
  user_id: string
  created_at: string
  diffs: any
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

export async function getWorkflowLogs(workflowId: string): Promise<{ workflow?: { id: string; name: string }, logs: WorkflowLogEntry[] }> {
  const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/logs`, {
    credentials: 'include',
  })
  const data = await handleJsonResponse(res)
  return { workflow: data.workflow, logs: data.logs ?? [] }
}

export async function deleteWorkflowLog(workflowId: string, logId: string): Promise<{ success: boolean }> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/logs/${logId}`, {
    method: 'DELETE',
    headers: { 'x-csrf-token': csrfToken },
    credentials: 'include',
  })
  const data = await handleJsonResponse(res)
  return { success: Boolean(data?.success ?? true) }
}

export async function clearWorkflowLogs(workflowId: string): Promise<{ success: boolean }> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/logs`, {
    method: 'DELETE',
    headers: { 'x-csrf-token': csrfToken },
    credentials: 'include',
  })
  const data = await handleJsonResponse(res)
  return { success: Boolean(data?.success ?? true) }
}

export async function getWebhookUrl(workflowId: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/webhook-url`, {
    credentials: 'include'
  })
  const data = await handleJsonResponse(res)
  return data.url as string
}

export async function regenerateWebhookUrl(workflowId: string): Promise<string> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/webhook/regenerate`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    credentials: 'include'
  })
  const data = await handleJsonResponse(res)
  return data.url as string
}

export async function cancelRun(workflowId: string, runId: string): Promise<{ success: boolean }> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/runs/${runId}/cancel`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    credentials: 'include'
  })
  const data = await handleJsonResponse(res)
  return { success: Boolean(data?.success ?? true) }
}

// Runs API
export interface WorkflowRunRecord {
  id: string
  user_id: string
  workflow_id: string
  snapshot: any
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  error?: string | null
  idempotency_key?: string | null
  started_at: string
  finished_at?: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowNodeRunRecord {
  id: string
  run_id: string
  node_id: string
  name?: string | null
  node_type?: string | null
  inputs?: any
  outputs?: any
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled'
  error?: string | null
  started_at: string
  finished_at?: string | null
  created_at: string
  updated_at: string
}

export async function startWorkflowRun(workflowId: string, opts?: { idempotencyKey?: string, context?: any }): Promise<WorkflowRunRecord> {
  const csrfToken = await getCsrfToken()
  const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify(opts ?? {})
  })
  const data = await handleJsonResponse(res)
  return data.run
}

export async function getWorkflowRunStatus(workflowId: string, runId: string): Promise<{ run: WorkflowRunRecord, node_runs: WorkflowNodeRunRecord[] }> {
  const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/runs/${runId}`, {
    credentials: 'include'
  })
  const data = await handleJsonResponse(res)
  return { run: data.run, node_runs: data.node_runs ?? [] }
}

export async function listActiveRuns(workflowId?: string): Promise<WorkflowRunRecord[]> {
  const qs = workflowId ? `?workflow_id=${encodeURIComponent(workflowId)}` : ''
  const res = await fetch(`${API_BASE_URL}/api/workflows/runs${qs}`, {
    credentials: 'include'
  })
  const data = await handleJsonResponse(res)
  return data.runs ?? []
}

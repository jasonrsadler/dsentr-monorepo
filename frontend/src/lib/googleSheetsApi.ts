import { API_BASE_URL } from './config'

export interface SheetItem {
  id: string
  title: string
}

export async function fetchSpreadsheetSheets(
  spreadsheetId: string,
  opts?: { scope?: 'personal' | 'workspace'; connectionId?: string }
): Promise<SheetItem[]> {
  if (!spreadsheetId || !spreadsheetId.trim()) return []
  const encoded = encodeURIComponent(spreadsheetId.trim())
  const params = new URLSearchParams()
  if (opts?.scope) params.set('scope', opts.scope)
  if (opts?.connectionId) params.set('connection_id', opts.connectionId)

  const url = `${API_BASE_URL}/api/google/spreadsheets/${encoded}/sheets${
    params.toString() ? `?${params.toString()}` : ''
  }`

  const res = await fetch(url, { credentials: 'include' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = json?.message || json?.error || 'Failed to list sheets'
    throw new Error(message)
  }
  return (json.sheets || []) as SheetItem[]
}

export async function fetchSpreadsheetFiles(opts?: {
  scope?: 'personal' | 'workspace'
  connectionId?: string
}): Promise<SheetItem[]> {
  const params = new URLSearchParams()
  if (opts?.scope) params.set('scope', opts.scope)
  if (opts?.connectionId) params.set('connection_id', opts.connectionId)

  const url = `${API_BASE_URL}/api/google/spreadsheets/files${
    params.toString() ? `?${params.toString()}` : ''
  }`

  const res = await fetch(url, { credentials: 'include' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message =
      json?.message || json?.error || 'Failed to list spreadsheets'
    throw new Error(message)
  }
  return (json.files || []) as SheetItem[]
}

export async function fetchGoogleAccessToken(opts?: {
  scope?: 'personal' | 'workspace'
  connectionId?: string
}): Promise<string> {
  const params = new URLSearchParams()
  if (opts?.scope) params.set('scope', opts.scope)
  if (opts?.connectionId) params.set('connection_id', opts.connectionId)
  const url = `${API_BASE_URL}/api/google/token${params.toString() ? `?${params.toString()}` : ''}`

  const res = await fetch(url, { credentials: 'include' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = json?.message || json?.error || 'Failed to get access token'
    throw new Error(message)
  }
  return json.access_token as string
}

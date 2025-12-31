import { API_BASE_URL } from './config'
import type { ConnectionScope } from './oauthApi'

interface NotionApiResponse {
  success?: boolean
  message?: string
}

export interface NotionDatabase {
  id: string
  name: string
  url?: string
}

export interface NotionSelectOption {
  id?: string
  name?: string
  color?: string
}

export interface NotionProperty {
  property_id: string
  name: string
  property_type: string
  options?: NotionSelectOption[]
  is_title: boolean
}

export interface NotionDatabaseSchema {
  database_id: string
  title_property_id?: string
  properties: NotionProperty[]
}

interface NotionDatabasesResponse extends NotionApiResponse {
  databases?: NotionDatabase[]
  next_cursor?: string | null
  has_more?: boolean
}

interface NotionDatabaseSchemaResponse extends NotionApiResponse {
  database_id?: string
  title_property_id?: string | null
  properties?: NotionProperty[]
}

const normalizeString = (value?: string | null) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const buildConnectionQuery = (options: {
  scope: ConnectionScope
  connectionId: string
  search?: string
  cursor?: string | null
  pageSize?: number
}) => {
  const params = new URLSearchParams()
  params.set('connectionScope', options.scope)
  params.set('connectionId', options.connectionId)
  const search = normalizeString(options.search)
  const cursor = normalizeString(options.cursor ?? undefined)
  if (search) {
    params.set('search', search)
  }
  if (cursor) {
    params.set('cursor', cursor)
  }
  if (
    typeof options.pageSize === 'number' &&
    Number.isFinite(options.pageSize)
  ) {
    params.set('pageSize', `${options.pageSize}`)
  }
  return params.toString()
}

async function requestJson<T extends NotionApiResponse>(
  path: string,
  errorLabel: string
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include'
  })

  let payload: T | null = null
  try {
    payload = (await res.json()) as T
  } catch {
    payload = null
  }

  const success = payload?.success !== false && res.ok
  if (!success) {
    const message = payload?.message || `${errorLabel} request failed`
    throw new Error(message)
  }

  return payload ?? ({ success: true } as T)
}

export async function fetchNotionDatabases(options: {
  scope: ConnectionScope
  connectionId: string
  search?: string
  cursor?: string | null
  pageSize?: number
}): Promise<{
  databases: NotionDatabase[]
  nextCursor?: string
  hasMore: boolean
}> {
  const query = buildConnectionQuery(options)
  const data = await requestJson<NotionDatabasesResponse>(
    `/api/integrations/notion/databases?${query}`,
    'Notion databases'
  )

  const databases = Array.isArray(data.databases) ? data.databases : []
  return {
    databases: databases
      .filter((db) => typeof db?.id === 'string' && db.id.trim())
      .map((db) => ({
        id: db.id.trim(),
        name: normalizeString(db.name) || db.id.trim(),
        url: normalizeString(db.url)
      })),
    nextCursor: normalizeString(data.next_cursor ?? undefined),
    hasMore: Boolean(data.has_more)
  }
}

export async function fetchNotionDatabaseSchema(
  databaseId: string,
  options: { scope: ConnectionScope; connectionId: string }
): Promise<NotionDatabaseSchema> {
  const trimmedId = normalizeString(databaseId)
  if (!trimmedId) {
    throw new Error('Notion database id is required')
  }
  const query = buildConnectionQuery({
    scope: options.scope,
    connectionId: options.connectionId
  })

  const encodedId = encodeURIComponent(trimmedId)
  const data = await requestJson<NotionDatabaseSchemaResponse>(
    `/api/integrations/notion/databases/${encodedId}/schema?${query}`,
    'Notion database schema'
  )

  const properties = Array.isArray(data.properties) ? data.properties : []
  const normalizedProperties = (properties ?? []).filter(
    (p: any) =>
      typeof p?.propertyId === 'string' &&
      typeof p?.propertyType === 'string' &&
      p.propertyId.trim() &&
      p.propertyType.trim()
  )

  return {
    database_id: normalizeString(data.database_id) || trimmedId,
    title_property_id: normalizeString(data.title_property_id ?? undefined),
    properties: normalizedProperties.map((property: any) => {
      const options = Array.isArray(property.options)
        ? property.options.filter(
            (opt: any) =>
              normalizeString(opt.id) ||
              normalizeString(opt.name) ||
              normalizeString(opt.color)
          )
        : undefined

      return {
        property_id: property.propertyId.trim(),
        name: normalizeString(property.name) || property.propertyId.trim(),
        property_type: property.propertyType.trim().toLowerCase(),
        ...(options ? { options } : {}),
        is_title: Boolean(property.isTitle)
      }
    })
  }
}

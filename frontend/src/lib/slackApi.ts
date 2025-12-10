import { API_BASE_URL } from './config'
import type { ConnectionScope } from './oauthApi'

type SlackChannelsApiResponse = {
  success?: boolean
  message?: string
  channels?: { id?: string; name?: string | null; isPrivate?: boolean }[]
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate?: boolean
}

export interface SlackChannelOptions {
  scope?: ConnectionScope
  connectionId?: string | null
}

function appendConnectionQuery(
  path: string,
  options?: SlackChannelOptions
): string {
  if (!options) return path

  const params = new URLSearchParams()

  if (options.scope) {
    params.set('scope', options.scope)
  }

  const trimmedId = options.connectionId?.trim()
  if (trimmedId) {
    params.set('connection_id', trimmedId)
  }

  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export async function fetchSlackChannels(
  options?: SlackChannelOptions
): Promise<SlackChannel[]> {
  const res = await fetch(
    `${API_BASE_URL}${appendConnectionQuery('/api/slack/channels', options)}`,
    { credentials: 'include' }
  )

  let payload: SlackChannelsApiResponse | null = null
  try {
    payload = (await res.json()) as SlackChannelsApiResponse
  } catch (error) {
    payload = null
  }

  const success = payload?.success !== false && res.ok
  if (!success) {
    const message =
      payload?.message || "We couldn't load Slack channels. Try again."
    throw new Error(message)
  }

  const channels = Array.isArray(payload?.channels) ? payload!.channels! : []

  return channels
    .filter((channel) => typeof channel?.id === 'string' && channel.id!.trim())
    .map((channel) => ({
      id: channel!.id!.trim(),
      name: (channel?.name && channel.name.trim()) || channel!.id!.trim(),
      isPrivate: channel?.isPrivate
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

import { API_BASE_URL } from './config'

type SlackChannelsApiResponse = {
  success?: boolean
  message?: string
  type?: string
  connectionId?: string
  channels?: { id?: string; name?: string | null; isPrivate?: boolean }[]
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate?: boolean
}

export interface SlackChannelFetchOptions {
  workspaceConnectionId: string
}

function appendConnectionQuery(
  path: string,
  options: SlackChannelFetchOptions
): string {
  const params = new URLSearchParams()

  const trimmedWorkspaceId = options.workspaceConnectionId.trim()
  if (!trimmedWorkspaceId) {
    throw new Error(
      'Slack requires a workspace connection to fetch channels. Install Slack at workspace scope.'
    )
  }
  params.set('workspace_connection_id', trimmedWorkspaceId)

  const query = params.toString()
  return `${path}?${query}`
}

export async function fetchSlackChannels(
  options: SlackChannelFetchOptions
): Promise<SlackChannel[]> {
  // Immediate validation for required workspace connection
  if (!options.workspaceConnectionId?.trim()) {
    throw new Error(
      'Slack requires a workspace connection to fetch channels. Install Slack at workspace scope.'
    )
  }

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
    const message = payload?.message || ''

    if (payload?.type === 'auth_expired') {
      throw new Error(
        'The selected Slack connection expired. Reconnect Slack in Settings and try again.'
      )
    }

    // Map backend errors to explicit Slack-specific messages
    if (message.includes('No workspace Slack connection found')) {
      throw new Error(
        'Slack requires a workspace connection to fetch channels. Install Slack at workspace scope.'
      )
    }
    if (message.includes('Multiple workspace Slack connections')) {
      throw new Error(
        'Multiple workspace Slack connections are available. Please specify which workspace connection to use.'
      )
    }
    if (
      message.includes(
        'Selected workspace Slack connection is no longer available'
      )
    ) {
      throw new Error(
        'The selected workspace Slack connection is no longer available. Please reconnect in Settings.'
      )
    }
    if (message.includes('workspace OAuth token is required')) {
      throw new Error(
        'The selected workspace Slack connection only provides an incoming webhook. A workspace OAuth token is required to fetch channels.'
      )
    }
    // Default error for other cases
    throw new Error(
      message ||
        'Failed to fetch Slack channels. Please check your connection and try again.'
    )
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

import { API_BASE_URL } from './config'
import type { ConnectionScope } from './oauthApi'

type GraphApiResponse = {
  success: boolean
  message?: string
  [key: string]: any
}

interface TeamsApiResponse extends GraphApiResponse {
  teams?: { id?: string; displayName?: string | null }[]
}

interface ChannelsApiResponse extends GraphApiResponse {
  channels?: {
    id?: string
    displayName?: string | null
    membershipType?: string | null
  }[]
}

interface MembersApiResponse extends GraphApiResponse {
  members?: {
    id?: string | null
    userId?: string | null
    displayName?: string | null
    email?: string | null
  }[]
}

export interface MicrosoftTeam {
  id: string
  displayName: string
}

export interface MicrosoftChannel {
  id: string
  displayName: string
  membershipType?: string
}

export interface MicrosoftChannelMember {
  id: string
  userId: string
  displayName: string
  email?: string
}

export interface MicrosoftConnectionOptions {
  scope?: ConnectionScope
  connectionId?: string | null
}

function appendConnectionQuery(
  path: string,
  options?: MicrosoftConnectionOptions
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

async function requestJson<T extends GraphApiResponse>(
  path: string,
  errorLabel: string
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include'
  })

  let payload: T | null = null
  try {
    payload = (await res.json()) as T
  } catch (error) {
    payload = null
  }

  const success = payload?.success !== false && res.ok

  if (!success) {
    const message = payload?.message || `${errorLabel} request failed`
    throw new Error(message)
  }

  return payload ?? ({ success: true } as T)
}

export async function fetchMicrosoftTeams(
  options?: MicrosoftConnectionOptions
): Promise<MicrosoftTeam[]> {
  const data = await requestJson<TeamsApiResponse>(
    appendConnectionQuery('/api/microsoft/teams', options),
    'Microsoft Teams'
  )

  const teams = Array.isArray(data.teams) ? data.teams : []

  return teams
    .filter(
      (team) => typeof team?.id === 'string' && team.id!.trim().length > 0
    )
    .map((team) => ({
      id: team.id!.trim(),
      displayName:
        (team.displayName && team.displayName.trim()) || team.id!.trim()
    }))
}

export async function fetchMicrosoftTeamChannels(
  teamId: string,
  options?: MicrosoftConnectionOptions
): Promise<MicrosoftChannel[]> {
  const encodedTeam = encodeURIComponent(teamId)
  const data = await requestJson<ChannelsApiResponse>(
    appendConnectionQuery(
      `/api/microsoft/teams/${encodedTeam}/channels`,
      options
    ),
    'Microsoft Teams channels'
  )

  const channels = Array.isArray(data.channels) ? data.channels : []

  return channels
    .filter((channel) => typeof channel?.id === 'string' && channel.id!.trim())
    .map((channel) => ({
      id: channel.id!.trim(),
      displayName:
        (channel.displayName && channel.displayName.trim()) ||
        channel.id!.trim(),
      membershipType: channel.membershipType ?? undefined
    }))
}

export async function fetchMicrosoftChannelMembers(
  teamId: string,
  channelId: string,
  options?: MicrosoftConnectionOptions
): Promise<MicrosoftChannelMember[]> {
  const encodedTeam = encodeURIComponent(teamId)
  const encodedChannel = encodeURIComponent(channelId)
  const data = await requestJson<MembersApiResponse>(
    appendConnectionQuery(
      `/api/microsoft/teams/${encodedTeam}/channels/${encodedChannel}/members`,
      options
    ),
    'Microsoft channel members'
  )

  const members = Array.isArray(data.members) ? data.members : []

  return members
    .filter(
      (member) => typeof member?.userId === 'string' && member.userId!.trim()
    )
    .map((member) => {
      const userId = member.userId!.trim()
      const displayName =
        (member.displayName && member.displayName.trim()) || userId
      const email = member.email?.trim()

      return {
        id: (member.id ?? userId).toString(),
        userId,
        displayName,
        email: email || undefined
      }
    })
}

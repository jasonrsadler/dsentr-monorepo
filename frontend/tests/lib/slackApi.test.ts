import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchSlackChannels,
  type SlackChannelFetchOptions
} from '@/lib/slackApi'

// Mock the config
vi.mock('@/lib/config', () => ({
  API_BASE_URL: 'https://api.dsentr.test'
}))

describe('slackApi', () => {
  let globalFetch: typeof globalThis.fetch

  beforeEach(() => {
    globalFetch = global.fetch
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = globalFetch
    vi.clearAllMocks()
  })

  const buildFetchResponse = <T>(body: T, init?: ResponseInit): Response =>
    ({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(JSON.stringify(body))
    }) as Response

  describe('fetchSlackChannels', () => {
    it('throws when workspaceConnectionId is missing', async () => {
      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: ''
      }

      await expect(fetchSlackChannels(options)).rejects.toThrow(
        'Slack requires a workspace connection to fetch channels. Install Slack at workspace scope.'
      )

      await expect(
        fetchSlackChannels({ workspaceConnectionId: '   ' })
      ).rejects.toThrow(
        'Slack requires a workspace connection to fetch channels. Install Slack at workspace scope.'
      )
    })

    it('throws when workspaceConnectionId is null or undefined', async () => {
      await expect(
        fetchSlackChannels({ workspaceConnectionId: null as any })
      ).rejects.toThrow(
        'Slack requires a workspace connection to fetch channels. Install Slack at workspace scope.'
      )

      await expect(
        fetchSlackChannels({ workspaceConnectionId: undefined as any })
      ).rejects.toThrow(
        'Slack requires a workspace connection to fetch channels. Install Slack at workspace scope.'
      )
    })

    it('includes workspace_connection_id in request URL', async () => {
      const mockChannels = [
        { id: 'C123', name: 'general', isPrivate: false },
        { id: 'C456', name: 'random', isPrivate: false }
      ]

      const mockResponse = buildFetchResponse({
        success: true,
        channels: mockChannels
      })

      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: 'ws-123'
      }

      const result = await fetchSlackChannels(options)

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.dsentr.test/api/slack/channels?workspace_connection_id=ws-123',
        { credentials: 'include' }
      )

      expect(result).toEqual([
        { id: 'C123', name: 'general', isPrivate: false },
        { id: 'C456', name: 'random', isPrivate: false }
      ])
    })

    it('trims whitespace from connection ID', async () => {
      const mockResponse = buildFetchResponse({
        success: true,
        channels: []
      })

      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: '  ws-123  '
      }

      await fetchSlackChannels(options)

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.dsentr.test/api/slack/channels?workspace_connection_id=ws-123',
        { credentials: 'include' }
      )
    })

    it('filters and sorts channels correctly', async () => {
      const mockChannels = [
        { id: '', name: 'invalid-empty-id', isPrivate: false }, // Filtered out
        { id: '   ', name: 'invalid-whitespace-id', isPrivate: false }, // Filtered out
        { id: 'C123', name: null, isPrivate: false }, // Uses ID as name
        { id: 'C456', name: '', isPrivate: true }, // Uses ID as name
        { id: 'C789', name: 'zebra', isPrivate: false }, // Last alphabetically
        { id: 'C101', name: 'alpha', isPrivate: false }, // First alphabetically
        { id: 'C202', name: '  beta  ', isPrivate: false } // Trims whitespace
      ]

      const mockResponse = buildFetchResponse({
        success: true,
        channels: mockChannels
      })

      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: 'ws-123'
      }

      const result = await fetchSlackChannels(options)

      expect(result).toEqual([
        { id: 'C101', name: 'alpha', isPrivate: false },
        { id: 'C202', name: 'beta', isPrivate: false },
        { id: 'C123', name: 'C123', isPrivate: false },
        { id: 'C456', name: 'C456', isPrivate: true },
        { id: 'C789', name: 'zebra', isPrivate: false }
      ])
    })

    describe('backend error mapping', () => {
      it('maps No workspace Slack connection found error', async () => {
        const mockResponse = buildFetchResponse(
          {
            success: false,
            message: 'No workspace Slack connection found for workspace ws-123'
          },
          { ok: false, status: 400 }
        )

        ;(global.fetch as any).mockResolvedValue(mockResponse)

        const options: SlackChannelFetchOptions = {
          workspaceConnectionId: 'ws-123'
        }

        await expect(fetchSlackChannels(options)).rejects.toThrow(
          'Slack requires a workspace connection to fetch channels. Install Slack at workspace scope.'
        )
      })

      it('maps Multiple workspace Slack connections error', async () => {
        const mockResponse = buildFetchResponse(
          {
            success: false,
            message:
              'Multiple workspace Slack connections found. Please specify which one to use.'
          },
          { ok: false, status: 400 }
        )

        ;(global.fetch as any).mockResolvedValue(mockResponse)

        const options: SlackChannelFetchOptions = {
          workspaceConnectionId: 'ws-123'
        }

        await expect(fetchSlackChannels(options)).rejects.toThrow(
          'Multiple workspace Slack connections are available. Please specify which workspace connection to use.'
        )
      })

      it('maps workspace connection no longer available error', async () => {
        const mockResponse = buildFetchResponse(
          {
            success: false,
            message:
              'Selected workspace Slack connection is no longer available'
          },
          { ok: false, status: 404 }
        )

        ;(global.fetch as any).mockResolvedValue(mockResponse)

        const options: SlackChannelFetchOptions = {
          workspaceConnectionId: 'ws-123'
        }

        await expect(fetchSlackChannels(options)).rejects.toThrow(
          'The selected workspace Slack connection is no longer available. Please reconnect in Settings.'
        )
      })

      it('maps webhook-only workspace connection error', async () => {
        const mockResponse = buildFetchResponse(
          {
            success: false,
            message: 'workspace OAuth token is required to fetch channels'
          },
          { ok: false, status: 400 }
        )

        ;(global.fetch as any).mockResolvedValue(mockResponse)

        const options: SlackChannelFetchOptions = {
          workspaceConnectionId: 'ws-123'
        }

        await expect(fetchSlackChannels(options)).rejects.toThrow(
          'The selected workspace Slack connection only provides an incoming webhook. A workspace OAuth token is required to fetch channels.'
        )
      })

      it('maps auth_expired error type', async () => {
        const mockResponse = buildFetchResponse(
          {
            success: false,
            type: 'auth_expired',
            connectionId: 'ws-123'
          },
          { ok: false, status: 401 }
        )

        ;(global.fetch as any).mockResolvedValue(mockResponse)

        const options: SlackChannelFetchOptions = {
          workspaceConnectionId: 'ws-123'
        }

        await expect(fetchSlackChannels(options)).rejects.toThrow(
          'The selected Slack connection expired. Reconnect Slack in Settings and try again.'
        )
      })

      it('falls back to default error for unknown errors', async () => {
        const mockResponse = buildFetchResponse(
          {
            success: false,
            message: 'Some unknown error occurred'
          },
          { ok: false, status: 500 }
        )

        ;(global.fetch as any).mockResolvedValue(mockResponse)

        const options: SlackChannelFetchOptions = {
          workspaceConnectionId: 'ws-123'
        }

        await expect(fetchSlackChannels(options)).rejects.toThrow(
          'Some unknown error occurred'
        )
      })

      it('falls back to generic error when no message provided', async () => {
        const mockResponse = buildFetchResponse(
          {
            success: false
          },
          { ok: false, status: 500 }
        )

        ;(global.fetch as any).mockResolvedValue(mockResponse)

        const options: SlackChannelFetchOptions = {
          workspaceConnectionId: 'ws-123'
        }

        await expect(fetchSlackChannels(options)).rejects.toThrow(
          'Failed to fetch Slack channels. Please check your connection and try again.'
        )
      })

      it('handles malformed JSON response', async () => {
        const mockResponse = {
          ok: false,
          status: 500,
          json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
          text: vi.fn().mockResolvedValue('Server error')
        } as Response

        ;(global.fetch as any).mockResolvedValue(mockResponse)

        const options: SlackChannelFetchOptions = {
          workspaceConnectionId: 'ws-123'
        }

        await expect(fetchSlackChannels(options)).rejects.toThrow(
          'Failed to fetch Slack channels. Please check your connection and try again.'
        )
      })
    })

    it('handles network errors', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: 'ws-123'
      }

      await expect(fetchSlackChannels(options)).rejects.toThrow('Network error')
    })

    it('handles empty channels array', async () => {
      const mockResponse = buildFetchResponse({
        success: true,
        channels: []
      })

      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: 'ws-123'
      }

      const result = await fetchSlackChannels(options)

      expect(result).toEqual([])
    })

    it('handles missing channels field', async () => {
      const mockResponse = buildFetchResponse({
        success: true
        // channels field missing
      })

      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: 'ws-123'
      }

      const result = await fetchSlackChannels(options)

      expect(result).toEqual([])
    })

    it('handles null channels field', async () => {
      const mockResponse = buildFetchResponse({
        success: true,
        channels: null
      })

      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: 'ws-123'
      }

      const result = await fetchSlackChannels(options)

      expect(result).toEqual([])
    })

    it('handles success: false but ok: true response', async () => {
      const mockResponse = buildFetchResponse(
        {
          success: false,
          message: 'Backend validation failed'
        },
        { ok: true }
      )

      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const options: SlackChannelFetchOptions = {
        workspaceConnectionId: 'ws-123'
      }

      await expect(fetchSlackChannels(options)).rejects.toThrow(
        'Backend validation failed'
      )
    })
  })
})

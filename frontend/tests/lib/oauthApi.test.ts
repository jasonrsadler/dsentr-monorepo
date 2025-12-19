import { beforeEach, describe, expect, it, vi } from 'vitest'

import { disconnectProvider, refreshProvider } from '@/lib/oauthApi'

const getCsrfToken = vi.hoisted(() => vi.fn().mockResolvedValue('csrf-token'))

vi.mock('@/lib/config', () => ({
  API_BASE_URL: 'http://api.test'
}))

vi.mock('@/lib/csrfCache', () => ({
  getCsrfToken
}))

describe('oauthApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCsrfToken.mockResolvedValue('csrf-token')
    global.fetch = vi.fn()
  })

  it('throws when connectionId is missing or blank for refresh', async () => {
    await expect(refreshProvider('google', '   ')).rejects.toThrow(
      /connectionid is required/i
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('throws when connectionId is missing or blank for disconnect', async () => {
    await expect(disconnectProvider('google', '')).rejects.toThrow(
      /connectionid is required/i
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends connection_id when refreshing a provider', async () => {
    const responsePayload = {
      success: true,
      requiresReconnect: false,
      accountEmail: 'owner@example.com',
      expiresAt: '2025-01-01T00:00:00.000Z',
      lastRefreshedAt: '2024-12-31T15:30:00.000Z'
    }
    ;(global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => responsePayload
    })

    await refreshProvider('google', 'conn-123')

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as vi.Mock).mock.calls[0]
    expect(String(url)).toContain(
      '/api/oauth/google/refresh?connection_id=conn-123'
    )
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' })
    })
  })

  it('sends connection_id when disconnecting a provider', async () => {
    ;(global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    })

    await disconnectProvider('slack', 'conn-456')

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as vi.Mock).mock.calls[0]
    expect(String(url)).toContain(
      '/api/oauth/slack/disconnect?connection_id=conn-456'
    )
    expect(init).toMatchObject({
      method: 'DELETE',
      credentials: 'include',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' })
    })
  })

  it('enforces provider type at compile time', () => {
    type ProviderParam = Parameters<typeof refreshProvider>[0]
    // @ts-expect-error invalid provider should not compile
    const invalidProvider: ProviderParam = 'unknown-provider'
    expect(invalidProvider).toBeDefined()
  })
})

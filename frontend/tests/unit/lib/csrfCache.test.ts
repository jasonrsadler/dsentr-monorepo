// src/tests/lib/csrfCache.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL } from '@/lib/config'

describe('getCsrfToken', () => {
  const mockToken = 'mocked-token'

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('fetches and returns the CSRF token from API if not cached', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(mockToken)
    })
    vi.stubGlobal('fetch', mockFetch)

    const { getCsrfToken } = await import('@/lib/csrfCache')
    const token = await getCsrfToken()

    expect(token).toBe(mockToken)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/auth/csrf-token`, {
      credentials: 'include'
    })
  })

  it('returns the cached CSRF token without fetching again', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(mockToken)
    })
    vi.stubGlobal('fetch', mockFetch)

    const { getCsrfToken } = await import('@/lib/csrfCache')

    const token1 = await getCsrfToken()
    const token2 = await getCsrfToken()

    expect(token1).toBe(mockToken)
    expect(token2).toBe(mockToken)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('throws an error if fetch fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', mockFetch)

    const { getCsrfToken } = await import('@/lib/csrfCache')

    await expect(getCsrfToken()).rejects.toThrow('Failed to fetch CSRF token')
    expect(fetch).toHaveBeenCalledOnce()
  })
})

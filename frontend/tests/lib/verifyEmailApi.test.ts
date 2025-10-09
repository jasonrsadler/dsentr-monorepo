import { Mock } from 'node:test'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as csrfCache from '@/lib/csrfCache'

// Mock the entire csrfCache module upfront with a default mock for getCsrfToken
vi.mock('@/lib/csrfCache')

describe('verifyEmail', () => {
  const mockCsrf = 'mock-csrf-token'
  const token = 'example-token'

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns failure if token is null', async () => {
    const { verifyEmail } = await import('@/lib/verifyEmailApi')
    const result = await verifyEmail(null)

    expect(result).toEqual({
      success: false,
      message: 'Missing token'
    })
  })

  it('returns success if API call succeeds', async () => {
    // Set mocked getCsrfToken implementation
    //const { getCsrfToken } = await import('@/lib/csrfCache')
    const getCsrfTokenMock = csrfCache.getCsrfToken as unknown as Mock<
      () => Promise<string>
    >

    // @ts-expect-error
    getCsrfTokenMock.mockResolvedValue('mock-csrf-token')

    // Mock fetch globally
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true })
    })
    vi.stubGlobal('fetch', mockFetch)

    const { verifyEmail } = await import('@/lib/verifyEmailApi')
    const result = await verifyEmail(token)

    expect(result).toEqual({ success: true })
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(getCsrfTokenMock).toHaveBeenCalledOnce()
  })

  it('returns failure if response is not ok or data.success is false', async () => {
    const { getCsrfToken } = await import('@/lib/csrfCache')
    // @ts-expect-error
    getCsrfToken.mockResolvedValue(mockCsrf)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: vi
        .fn()
        .mockResolvedValue({ success: false, message: 'Invalid token' })
    })
    vi.stubGlobal('fetch', mockFetch)

    const { verifyEmail } = await import('@/lib/verifyEmailApi')
    const result = await verifyEmail(token)

    expect(result).toEqual({
      success: false,
      message: 'Invalid token'
    })
  })

  it('returns failure with error message on fetch throw', async () => {
    const { getCsrfToken } = await import('@/lib/csrfCache')
    // @ts-expect-error
    getCsrfToken.mockResolvedValue(mockCsrf)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network failure'))
    )

    const { verifyEmail } = await import('@/lib/verifyEmailApi')
    const result = await verifyEmail(token)

    expect(result).toEqual({
      success: false,
      message: 'Network failure'
    })
  })

  it('returns generic error message for non-Error exceptions', async () => {
    const { getCsrfToken } = await import('@/lib/csrfCache')
    // @ts-expect-error
    getCsrfToken.mockResolvedValue(mockCsrf)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        throw 'string-error'
      })
    )

    const { verifyEmail } = await import('@/lib/verifyEmailApi')
    const result = await verifyEmail(token)

    expect(result).toEqual({
      success: false,
      message: 'Unexpected error occurred'
    })
  })
})

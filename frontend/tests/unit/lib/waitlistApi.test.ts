// src/tests/lib/joinWaitlistApi.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { joinWaitlist } from '@/lib/waitlistApi'

const mockEmail = 'test@example.com'
const apiUrl = '/api/early-access'

describe('joinWaitlist', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a success message if API call succeeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        message: 'Thanks for signing up!'
      })
    })

    const message = await joinWaitlist(mockEmail)
    expect(message).toBe('Thanks for signing up!')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(apiUrl),
      expect.anything()
    )
  })

  it('throws an error if API returns failure status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'error',
        message: 'already on the list'
      })
    })

    const consoleError = console.error
    console.error = vi.fn()
    await expect(joinWaitlist(mockEmail)).rejects.toThrow('already on the list')
    console.error = consoleError
  })

  it('throws a generic error if fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const consoleError = console.error
    console.error = vi.fn()
    await expect(joinWaitlist(mockEmail)).rejects.toThrow(
      'An error occurred while joining the waitlist. Please try again later.'
    )
    console.error = consoleError
  })

  it('throws a generic error if response is malformed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        status: 'fail',
        message: undefined
      })
    })
    const consoleError = console.error
    console.error = vi.fn()
    await expect(joinWaitlist(mockEmail)).rejects.toThrow(
      'An error occurred while joining the waitlist. Please try again later.'
    )
    console.error = consoleError
  })
})

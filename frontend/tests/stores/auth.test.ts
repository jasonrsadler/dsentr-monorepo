import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { useAuth } from '@/stores/auth'
import * as csrfCache from '@/lib/csrfCache'
import { act } from '@testing-library/react'

const mockUser = {
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@example.com',
  id: '123',
  role: 'user',
  plan: 'free',
  companyName: 'Acme Corp'
}

describe('auth.ts', () => {
  beforeEach(() => {
    // Reset Zustand store
    useAuth.setState({
      user: null,
      isLoading: true,
      memberships: [],
      requiresOnboarding: false
    })

    // Mock fetch
    global.fetch = vi.fn()
    vi.spyOn(csrfCache, 'getCsrfToken').mockResolvedValue('mock-csrf-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('login updates user and sets isLoading to false', () => {
    act(() => {
      useAuth.getState().login(mockUser)
    })

    const state = useAuth.getState()
    expect(state.user).toEqual(mockUser)
    expect(state.isLoading).toBe(false)
    expect(state.memberships).toEqual([])
  })

  it('logout calls API and resets auth state', async () => {
    ;(fetch as Mock).mockResolvedValue({ ok: true })

    await act(async () => {
      await useAuth.getState().logout()
    })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/logout'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-csrf-token': 'mock-csrf-token'
        })
      })
    )

    const state = useAuth.getState()
    expect(state.user).toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.memberships).toEqual([])
  })

  it('checkAuth sets user on success', async () => {
    ;(fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ user: mockUser, memberships: [] })
    })

    await act(async () => {
      await useAuth.getState().checkAuth()
    })

    const state = useAuth.getState()
    expect(state.user).toEqual(mockUser)
    expect(state.isLoading).toBe(false)
    expect(state.memberships).toEqual([])
  })

  it('checkAuth clears user on error', async () => {
    ;(fetch as Mock).mockResolvedValue({ ok: false })

    await act(async () => {
      await useAuth.getState().checkAuth()
    })

    const state = useAuth.getState()
    expect(state.user).toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.memberships).toEqual([])
  })
})

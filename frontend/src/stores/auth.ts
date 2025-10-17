import { API_BASE_URL } from '@/lib'
import { getCsrfToken } from '@/lib/csrfCache'
import { create } from 'zustand'

type User = {
  first_name: string
  last_name: string
  email: string
  id: string
  role: string
  plan: string | null
  companyName: string | null
  onboarded_at?: string | null
}

type WorkspaceSummary = {
  workspace: {
    id: string
    name: string
    created_by: string
    owner_id: string
    plan: string
    created_at: string
    updated_at: string
    deleted_at?: string | null
  }
  role: 'owner' | 'admin' | 'user' | 'viewer'
}

type CheckAuthOptions = {
  silent?: boolean
}

type AuthState = {
  user: User | null
  isLoading: boolean
  memberships: WorkspaceSummary[]
  requiresOnboarding: boolean

  login: (
    user: User,
    memberships?: WorkspaceSummary[],
    requiresOnboarding?: boolean
  ) => void
  logout: () => void
  checkAuth: (options?: CheckAuthOptions) => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  memberships: [],
  requiresOnboarding: false,

  login: (user, memberships = [], requiresOnboarding = false) =>
    set({
      user,
      memberships,
      requiresOnboarding,
      isLoading: false
    }),

  logout: async () => {
    const csrfToken = await getCsrfToken()
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      }
    })
    set({
      user: null,
      memberships: [],
      requiresOnboarding: false,
      isLoading: false
    })
  },

  checkAuth: async (options) => {
    if (!options?.silent) {
      set({ isLoading: true }) // explicitly show loading when not silent
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: 'GET',
        credentials: 'include'
      })
      if (!res.ok) throw new Error('Not authenticated')
      const data = await res.json()
      const normalizedUser = data?.user
        ? {
            ...data.user,
            plan: data.user.plan ?? null,
            companyName: data.user.company_name ?? null
          }
        : null
      set({
        user: normalizedUser,
        memberships: data?.memberships ?? [],
        requiresOnboarding: Boolean(data?.requires_onboarding),
        isLoading: false
      })
    } catch {
      set({
        user: null,
        memberships: [],
        requiresOnboarding: false,
        isLoading: false
      })
    }
  }
}))

import { API_BASE_URL } from '@/lib'
import { getCsrfToken } from '@/lib/csrfCache'
import {
  listWorkspaces,
  type WorkspaceMembershipSummary
} from '@/lib/orgWorkspaceApi'
import { create } from 'zustand'

type User = {
  first_name: string
  last_name: string
  email: string
  id: string
  role: string
  plan: string | null
  companyName: string | null
  oauthProvider: 'google' | 'github' | 'apple' | 'email' | null
  onboarded_at?: string | null
}

type WorkspaceSummary = WorkspaceMembershipSummary

type CheckAuthOptions = {
  silent?: boolean
}

type AuthState = {
  user: User | null
  isLoading: boolean
  memberships: WorkspaceSummary[]
  currentWorkspaceId: string | null
  requiresOnboarding: boolean

  login: (
    user: User,
    memberships?: WorkspaceSummary[],
    requiresOnboarding?: boolean
  ) => void
  logout: () => void
  checkAuth: (options?: CheckAuthOptions) => Promise<void>
  setCurrentWorkspaceId: (workspaceId: string) => void
  refreshMemberships: () => Promise<WorkspaceSummary[]>
}

const WORKSPACE_STORAGE_KEY = 'dsentr.currentWorkspaceId'

function readStoredWorkspaceId() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
  } catch {
    return null
  }
}

function persistWorkspaceId(workspaceId: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (workspaceId) {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId)
    } else {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    }
  } catch {
    /* ignore storage failures */
  }
}

function resolveWorkspaceSelection(
  memberships: WorkspaceSummary[],
  preferredId?: string | null
) {
  if (!Array.isArray(memberships) || memberships.length === 0) {
    return null
  }

  const eligibleMemberships = memberships.filter(
    (membership) => membership.workspace?.id
  )
  if (eligibleMemberships.length === 0) {
    return null
  }

  if (preferredId) {
    const match = eligibleMemberships.find(
      (membership) => membership.workspace.id === preferredId
    )
    if (match) return match.workspace.id
  }

  const ownedWorkspace = eligibleMemberships.find(
    (membership) => membership.role === 'owner'
  )
  if (ownedWorkspace) {
    return ownedWorkspace.workspace.id
  }

  return eligibleMemberships[0]?.workspace.id ?? null
}

export function selectCurrentWorkspace(state: {
  memberships: WorkspaceSummary[]
  currentWorkspaceId: string | null
}): WorkspaceSummary | null {
  if (!Array.isArray(state.memberships) || state.memberships.length === 0) {
    return null
  }

  const resolvedId = resolveWorkspaceSelection(
    state.memberships,
    state.currentWorkspaceId
  )

  if (!resolvedId) return null

  return (
    state.memberships.find(
      (membership) => membership.workspace.id === resolvedId
    ) ??
    state.memberships[0] ??
    null
  )
}

const initialWorkspaceId = readStoredWorkspaceId()

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  memberships: [],
  currentWorkspaceId: initialWorkspaceId,
  requiresOnboarding: false,

  login: (user, memberships = [], requiresOnboarding = false) => {
    const preferred = get().currentWorkspaceId ?? readStoredWorkspaceId()
    const resolved = resolveWorkspaceSelection(memberships, preferred)
    persistWorkspaceId(resolved)
    set({
      user,
      memberships,
      currentWorkspaceId: resolved,
      requiresOnboarding,
      isLoading: false
    })
  },

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
    persistWorkspaceId(null)
    set({
      user: null,
      memberships: [],
      currentWorkspaceId: null,
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
      // Accept both camelCase and snake_case from the API. Do not add extra
      // keys beyond what the server returns (tests may assert deep equality).
      const incoming = (data?.user ?? null) as any
      const normalizedUser = incoming
        ? {
            ...incoming,
            // If camelCase fields already exist, keep them; otherwise fold in snake_case.
            ...(incoming.companyName == null && incoming.company_name != null
              ? { companyName: incoming.company_name }
              : {}),
            ...(incoming.oauthProvider == null && incoming.oauth_provider != null
              ? { oauthProvider: incoming.oauth_provider }
              : {})
          }
        : null
      const memberships = (data?.memberships ?? []) as WorkspaceSummary[]
      const preferred = get().currentWorkspaceId ?? readStoredWorkspaceId()
      const resolvedWorkspaceId = resolveWorkspaceSelection(
        memberships,
        preferred
      )
      persistWorkspaceId(resolvedWorkspaceId)
      set({
        user: normalizedUser,
        memberships,
        currentWorkspaceId: resolvedWorkspaceId,
        requiresOnboarding: Boolean(data?.requires_onboarding),
        isLoading: false
      })
    } catch {
      persistWorkspaceId(null)
      set({
        user: null,
        memberships: [],
        currentWorkspaceId: null,
        requiresOnboarding: false,
        isLoading: false
      })
    }
  },

  setCurrentWorkspaceId: (workspaceId) => {
    set((state) => {
      const exists = state.memberships.some(
        (membership) => membership.workspace.id === workspaceId
      )
      const resolved = exists
        ? workspaceId
        : resolveWorkspaceSelection(state.memberships)
      persistWorkspaceId(resolved)
      return { currentWorkspaceId: resolved }
    })
  },

  refreshMemberships: async () => {
    const memberships = await listWorkspaces()
    const preferred = get().currentWorkspaceId
    const resolved = resolveWorkspaceSelection(memberships, preferred)
    persistWorkspaceId(resolved)
    set({ memberships, currentWorkspaceId: resolved })
    return memberships
  }
}))

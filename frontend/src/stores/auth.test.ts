import { beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import type { WorkspaceMembershipSummary } from '@/lib/orgWorkspaceApi'

const initialStore = useAuth.getState()

function resetAuthStore() {
  useAuth.setState(initialStore, true)
  window.localStorage.clear()
}

function createMembership(
  id: string,
  name: string,
  plan: string,
  role: WorkspaceMembershipSummary['role']
): WorkspaceMembershipSummary {
  const now = new Date().toISOString()
  return {
    workspace: {
      id,
      name,
      plan,
      created_at: now,
      updated_at: now,
      created_by: 'creator',
      owner_id: role === 'owner' ? 'owner-user' : 'creator',
      deleted_at: null
    },
    role
  }
}

describe('useAuth workspace selection', () => {
  beforeEach(() => {
    resetAuthStore()
  })

  it('falls back to the owned workspace when the preferred workspace is missing', () => {
    const { login } = useAuth.getState()
    const preferredWorkspaceId = 'removed-workspace'

    window.localStorage.setItem(
      'dsentr.currentWorkspaceId',
      preferredWorkspaceId
    )
    useAuth.setState((state) => ({
      ...state,
      currentWorkspaceId: preferredWorkspaceId
    }))

    const collaboratorMembership = createMembership(
      'shared-workspace',
      'Shared Workspace',
      'workspace',
      'admin'
    )
    const ownedMembership = createMembership(
      'owned-workspace',
      'Owned Workspace',
      'solo',
      'owner'
    )

    login(
      {
        id: 'user-1',
        email: 'owner@example.com',
        first_name: 'Owner',
        last_name: 'User',
        plan: 'solo',
        role: 'owner',
        companyName: null
      },
      [collaboratorMembership, ownedMembership]
    )

    expect(useAuth.getState().currentWorkspaceId).toBe('owned-workspace')
    expect(window.localStorage.getItem('dsentr.currentWorkspaceId')).toBe(
      'owned-workspace'
    )
  })
})

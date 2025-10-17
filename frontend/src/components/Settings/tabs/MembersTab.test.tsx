import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MembersTab from './MembersTab'
import { useAuth } from '@/stores/auth'
import {
  HttpError,
  listWorkspaceInvites,
  listWorkspaceMembers,
  leaveWorkspace
} from '@/lib/orgWorkspaceApi'
import type { WorkspaceMembershipSummary } from '@/lib/orgWorkspaceApi'

vi.mock('@/lib/orgWorkspaceApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orgWorkspaceApi')>(
    '@/lib/orgWorkspaceApi'
  )
  return {
    ...actual,
    listWorkspaceMembers: vi.fn(),
    listWorkspaceInvites: vi.fn(),
    leaveWorkspace: vi.fn()
  }
})

const initialStore = useAuth.getState()
const { login, logout, checkAuth, setCurrentWorkspaceId, refreshMemberships } =
  initialStore

function resetAuthStore() {
  useAuth.setState(
    {
      user: null,
      isLoading: false,
      memberships: [],
      currentWorkspaceId: null,
      requiresOnboarding: false,
      login,
      logout,
      checkAuth,
      setCurrentWorkspaceId,
      refreshMemberships
    },
    true
  )
}

const soloMembership: WorkspaceMembershipSummary = {
  workspace: {
    id: 'workspace-solo',
    name: 'Solo Workspace',
    plan: 'solo',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    created_by: 'owner',
    owner_id: 'owner'
  },
  role: 'owner'
}

const workspaceMembership: WorkspaceMembershipSummary = {
  workspace: {
    id: 'workspace-team',
    name: 'Team Workspace',
    plan: 'workspace',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    created_by: 'owner',
    owner_id: 'owner'
  },
  role: 'admin'
}

const viewerWorkspaceMembership: WorkspaceMembershipSummary = {
  workspace: { ...workspaceMembership.workspace },
  role: 'viewer'
}

describe('MembersTab workspace actions', () => {
  const listMembersMock = vi.mocked(listWorkspaceMembers)
  const listInvitesMock = vi.mocked(listWorkspaceInvites)
  const leaveWorkspaceMock = vi.mocked(leaveWorkspace)

  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    resetAuthStore()
    listMembersMock.mockResolvedValue([])
    listInvitesMock.mockResolvedValue([])
    leaveWorkspaceMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetAuthStore()
  })

  it('disables the leave workspace action for owners', async () => {
    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-owner',
          email: 'owner@example.com',
          first_name: 'Owner',
          last_name: 'User',
          plan: 'workspace',
          role: 'owner',
          companyName: null
        },
        memberships: [soloMembership],
        currentWorkspaceId: soloMembership.workspace.id
      }))
    })

    render(<MembersTab />)

    const leaveButton = await screen.findByRole('button', {
      name: /leave workspace/i
    })
    expect(leaveButton).toBeDisabled()
  })

  it('updates gating copy when switching from solo to workspace membership', async () => {
    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-switch',
          email: 'switch@example.com',
          first_name: 'Switch',
          last_name: 'Tester',
          plan: 'solo',
          role: 'admin',
          companyName: null
        },
        memberships: [soloMembership, workspaceMembership],
        currentWorkspaceId: soloMembership.workspace.id
      }))
    })

    render(<MembersTab />)

    expect(
      await screen.findByText(/upgrade to the workspace plan/i)
    ).toBeInTheDocument()

    const select = await screen.findByRole('combobox')
    const userEvents = userEvent.setup()
    await userEvents.selectOptions(select, workspaceMembership.workspace.id)

    await waitFor(() => {
      expect(
        screen.queryByText(/upgrade to the workspace plan/i)
      ).not.toBeInTheDocument()
    })
  })

  it('leaves a workspace and redirects to the solo workspace', async () => {
    const setCurrentWorkspaceIdMock = vi.fn()
    const checkAuthMock = vi.fn().mockResolvedValue(undefined)
    const refreshMembershipsMock = vi.fn().mockResolvedValue([soloMembership])

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-admin',
          email: 'admin@example.com',
          first_name: 'Team',
          last_name: 'Member',
          plan: 'workspace',
          role: 'admin',
          companyName: null
        },
        memberships: [workspaceMembership, soloMembership],
        currentWorkspaceId: workspaceMembership.workspace.id,
        setCurrentWorkspaceId: setCurrentWorkspaceIdMock,
        refreshMemberships: refreshMembershipsMock,
        checkAuth: checkAuthMock
      }))
    })

    render(<MembersTab />)

    const leaveButton = await screen.findByRole('button', {
      name: /leave workspace/i
    })
    const user = userEvent.setup()
    await user.click(leaveButton)

    expect(leaveWorkspaceMock).toHaveBeenCalledWith(
      workspaceMembership.workspace.id
    )
    await waitFor(() => {
      expect(refreshMembershipsMock).toHaveBeenCalled()
    })
    expect(setCurrentWorkspaceIdMock).toHaveBeenCalledWith(
      soloMembership.workspace.id
    )
    expect(checkAuthMock).toHaveBeenCalledWith({ silent: true })
    expect(
      await screen.findByText(/redirected to your solo workspace/i)
    ).toBeInTheDocument()
  })

  it('handles revoked access by redirecting to the solo workspace', async () => {
    const setCurrentWorkspaceIdMock = vi.fn()
    const refreshMembershipsMock = vi.fn().mockResolvedValue([soloMembership])
    const checkAuthMock = vi.fn().mockResolvedValue(undefined)

    listMembersMock.mockRejectedValue(new HttpError('Forbidden', 403))

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-removed',
          email: 'removed@example.com',
          first_name: 'Removed',
          last_name: 'User',
          plan: 'workspace',
          role: 'admin',
          companyName: null
        },
        memberships: [workspaceMembership, soloMembership],
        currentWorkspaceId: workspaceMembership.workspace.id,
        setCurrentWorkspaceId: setCurrentWorkspaceIdMock,
        refreshMemberships: refreshMembershipsMock,
        checkAuth: checkAuthMock
      }))
    })

    render(<MembersTab />)

    await waitFor(() => {
      expect(refreshMembershipsMock).toHaveBeenCalled()
    })
    expect(setCurrentWorkspaceIdMock).toHaveBeenCalledWith(
      soloMembership.workspace.id
    )
    expect(checkAuthMock).toHaveBeenCalledWith({ silent: true })
    expect(
      await screen.findByText(/access to this workspace was revoked/i)
    ).toBeInTheDocument()
  })

  it('keeps the current workspace for viewer members while listing roster data', async () => {
    const setCurrentWorkspaceIdMock = vi.fn()
    listMembersMock.mockResolvedValue([
      {
        workspace_id: viewerWorkspaceMembership.workspace.id,
        user_id: 'member-1',
        role: 'admin',
        joined_at: new Date().toISOString(),
        email: 'member@example.com',
        first_name: 'Member',
        last_name: 'Viewer'
      }
    ])
    listInvitesMock.mockRejectedValue(new HttpError('Forbidden', 403))

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'viewer-user',
          email: 'viewer@example.com',
          first_name: 'View',
          last_name: 'Only',
          plan: 'workspace',
          role: 'user',
          companyName: null
        },
        memberships: [viewerWorkspaceMembership, soloMembership],
        currentWorkspaceId: viewerWorkspaceMembership.workspace.id,
        setCurrentWorkspaceId: setCurrentWorkspaceIdMock
      }))
    })

    render(<MembersTab />)

    expect(await screen.findByText('Member Viewer')).toBeInTheDocument()
    expect(setCurrentWorkspaceIdMock).not.toHaveBeenCalled()
    expect(listMembersMock).toHaveBeenCalledWith(
      viewerWorkspaceMembership.workspace.id
    )
    expect(listInvitesMock).not.toHaveBeenCalled()
  })

  it('loads pending invites for administrators', async () => {
    const invite = {
      id: 'invite-1',
      email: 'pending@example.com',
      role: 'user',
      expires_at: new Date().toISOString()
    }

    listMembersMock.mockResolvedValue([
      {
        workspace_id: workspaceMembership.workspace.id,
        user_id: 'member-admin',
        role: 'admin',
        joined_at: new Date().toISOString(),
        email: 'member.admin@example.com',
        first_name: 'Admin',
        last_name: 'Member'
      }
    ])
    listInvitesMock.mockResolvedValue([invite as any])

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-admin',
          email: 'admin@example.com',
          first_name: 'Admin',
          last_name: 'User',
          plan: 'workspace',
          role: 'admin',
          companyName: null
        },
        memberships: [workspaceMembership],
        currentWorkspaceId: workspaceMembership.workspace.id
      }))
    })

    render(<MembersTab />)

    expect(await screen.findByText('pending@example.com')).toBeInTheDocument()
    expect(listInvitesMock).toHaveBeenCalledWith(
      workspaceMembership.workspace.id
    )
  })

  it('redirects when workspace membership is no longer available (404)', async () => {
    const setCurrentWorkspaceIdMock = vi.fn()
    const refreshMembershipsMock = vi.fn().mockResolvedValue([soloMembership])
    const checkAuthMock = vi.fn().mockResolvedValue(undefined)
    listMembersMock.mockRejectedValue(new HttpError('Missing membership', 404))

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-admin',
          email: 'admin@example.com',
          first_name: 'Team',
          last_name: 'Member',
          plan: 'workspace',
          role: 'admin',
          companyName: null
        },
        memberships: [workspaceMembership, soloMembership],
        currentWorkspaceId: workspaceMembership.workspace.id,
        setCurrentWorkspaceId: setCurrentWorkspaceIdMock,
        refreshMemberships: refreshMembershipsMock,
        checkAuth: checkAuthMock
      }))
    })

    render(<MembersTab />)

    await waitFor(() => {
      expect(refreshMembershipsMock).toHaveBeenCalled()
    })
    expect(setCurrentWorkspaceIdMock).toHaveBeenCalledWith(
      soloMembership.workspace.id
    )
    expect(checkAuthMock).toHaveBeenCalledWith({ silent: true })
    expect(
      await screen.findByText(/redirected to your solo workspace/i)
    ).toBeInTheDocument()
  })
})

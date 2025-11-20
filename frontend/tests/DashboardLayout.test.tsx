import { useEffect } from 'react'
import { describe, beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import DashboardLayout from '@/layouts/DashboardLayout'
import { useAuth } from '@/stores/auth'
import * as authApi from '@/lib/authApi'
import * as workspaceApi from '@/lib/orgWorkspaceApi'
import type {
  WorkspaceInvitation,
  WorkspaceMembershipSummary
} from '@/lib/orgWorkspaceApi'

type LocationLike = ReturnType<typeof useLocation>

let listPendingInvitesSpy: vi.SpyInstance<Promise<WorkspaceInvitation[]>, []>

beforeEach(() => {
  vi.restoreAllMocks()
  listPendingInvitesSpy = vi
    .spyOn(workspaceApi, 'listPendingInvites')
    .mockResolvedValue([])
})

const initialStore = useAuth.getState()
const {
  login,
  logout,
  checkAuth,
  setCurrentWorkspaceId: originalSetCurrentWorkspaceId,
  refreshMemberships
} = initialStore

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
      setCurrentWorkspaceId: originalSetCurrentWorkspaceId,
      refreshMemberships
    },
    true
  )
}

function createMembership(
  id: string,
  name: string,
  plan: string = 'workspace',
  role: WorkspaceMembershipSummary['role'] = 'admin'
): WorkspaceMembershipSummary {
  return {
    workspace: {
      id,
      name,
      plan,
      created_by: 'creator',
      owner_id: 'owner',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null
    },
    role
  }
}

function createInvite(
  overrides: Partial<WorkspaceInvitation> = {}
): WorkspaceInvitation {
  const timestamp = new Date().toISOString()
  return {
    id: overrides.id ?? 'invite-1',
    workspace_id: overrides.workspace_id ?? 'workspace-invite',
    email: overrides.email ?? 'member@example.com',
    role: overrides.role ?? 'user',
    token: overrides.token ?? 'invite-token',
    status: overrides.status ?? 'pending',
    expires_at: overrides.expires_at ?? timestamp,
    created_by: overrides.created_by ?? 'owner-id',
    created_at: overrides.created_at ?? timestamp,
    accepted_at: overrides.accepted_at ?? null,
    revoked_at: overrides.revoked_at ?? null,
    declined_at: overrides.declined_at ?? null,
    workspace_name: overrides.workspace_name ?? 'Workspace Invite'
  }
}

function LocationObserver({
  onChange
}: {
  onChange: (location: LocationLike) => void
}) {
  const location = useLocation()
  useEffect(() => {
    onChange(location)
  }, [location, onChange])
  return null
}

describe('DashboardLayout workspace switcher', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetAuthStore()
  })

  it('auto-selects a sole workspace without rendering the switcher', async () => {
    const membership = createMembership('workspace-1', 'Solo Workspace', 'solo')
    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-1',
          email: 'user@example.com',
          first_name: 'Solo',
          last_name: 'User',
          plan: 'solo',
          role: 'owner',
          companyName: null,
          oauthProvider: null
        },
        memberships: [membership],
        currentWorkspaceId: null
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(useAuth.getState().currentWorkspaceId).toBe('workspace-1')
    })

    expect(
      screen.queryByLabelText(/workspace switcher/i)
    ).not.toBeInTheDocument()
    expect(screen.getByText(/solo workspace/i)).toBeInTheDocument()
  })

  it('renders a switcher for multiple workspaces and updates navigation', async () => {
    const memberships = [
      createMembership('workspace-a', 'Workspace A', 'workspace', 'owner'),
      createMembership('workspace-b', 'Workspace B')
    ]
    const onLocationChange = vi.fn()

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-2',
          email: 'multi@example.com',
          first_name: 'Multi',
          last_name: 'Member',
          plan: 'workspace',
          role: 'admin',
          companyName: null,
          oauthProvider: null
        },
        memberships,
        currentWorkspaceId: 'workspace-a'
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <>
                <LocationObserver onChange={onLocationChange} />
                <DashboardLayout />
              </>
            }
          >
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    const switcher = await screen.findByLabelText(/workspace switcher/i)
    expect(switcher).toHaveValue('workspace-a')

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalled()
    })
    const initialLocation = onLocationChange.mock.calls.at(-1)?.[0]
    expect(initialLocation?.search).toContain('workspace=workspace-a')

    const user = userEvent.setup()
    await user.selectOptions(switcher, 'workspace-b')

    await waitFor(() => {
      expect(useAuth.getState().currentWorkspaceId).toBe('workspace-b')
    })
    const updatedLocation = onLocationChange.mock.calls.at(-1)?.[0]
    expect(updatedLocation?.search).toContain('workspace=workspace-b')
  })

  it('does not resync to the previous workspace after manual selection', async () => {
    const memberships = [
      createMembership('workspace-a', 'Workspace A', 'workspace', 'owner'),
      createMembership('workspace-b', 'Workspace B', 'workspace', 'admin')
    ]
    const setCurrentWorkspaceIdSpy = vi.fn((workspaceId: string) =>
      originalSetCurrentWorkspaceId(workspaceId)
    )

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-4',
          email: 'stable@example.com',
          first_name: 'Stable',
          last_name: 'Member',
          plan: 'workspace',
          role: 'admin',
          companyName: null,
          oauthProvider: null
        },
        memberships,
        currentWorkspaceId: 'workspace-a',
        setCurrentWorkspaceId: setCurrentWorkspaceIdSpy
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']} initialIndex={0}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    const switcher = await screen.findByLabelText(/workspace switcher/i)

    await waitFor(() => {
      expect(useAuth.getState().currentWorkspaceId).toBe('workspace-a')
    })

    setCurrentWorkspaceIdSpy.mockClear()

    const user = userEvent.setup()
    await user.selectOptions(switcher, 'workspace-b')

    await waitFor(() => {
      expect(useAuth.getState().currentWorkspaceId).toBe('workspace-b')
    })

    expect(setCurrentWorkspaceIdSpy).toHaveBeenCalled()
    const calls = setCurrentWorkspaceIdSpy.mock.calls.flat()
    expect(calls).toContain('workspace-b')
    expect(calls).not.toContain('workspace-a')
  })

  it('updates the plan badge when switching active workspace', async () => {
    const memberships = [
      createMembership('workspace-a', 'Workspace A', 'solo', 'owner'),
      createMembership('workspace-b', 'Workspace B', 'workspace', 'admin')
    ]

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-plan',
          email: 'plan@example.com',
          first_name: 'Plan',
          last_name: 'Tester',
          plan: 'solo',
          role: 'admin',
          companyName: null,
          oauthProvider: null
        },
        memberships,
        currentWorkspaceId: 'workspace-a'
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    const header = await screen.findByRole('banner')
    expect(within(header).getByText(/Solo plan/i)).toBeInTheDocument()

    const switcher = await screen.findByLabelText(/workspace switcher/i)
    const userEventInstance = userEvent.setup()
    await userEventInstance.selectOptions(switcher, 'workspace-b')

    await waitFor(() => {
      expect(useAuth.getState().currentWorkspaceId).toBe('workspace-b')
    })

    expect(within(header).getByText(/Workspace plan/i)).toBeInTheDocument()
  })

  it('prefers workspace specified in the query string when available', async () => {
    const memberships = [
      createMembership('workspace-a', 'Workspace A'),
      createMembership('workspace-b', 'Workspace B')
    ]

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-3',
          email: 'query@example.com',
          first_name: 'Query',
          last_name: 'Member',
          plan: 'workspace',
          role: 'admin',
          companyName: null,
          oauthProvider: null
        },
        memberships,
        currentWorkspaceId: 'workspace-a'
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard?workspace=workspace-b']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    const switcher = await screen.findByLabelText(/workspace switcher/i)
    await waitFor(() => {
      expect(useAuth.getState().currentWorkspaceId).toBe('workspace-b')
    })
    expect(switcher).toHaveValue('workspace-b')
  })
})

describe('DashboardLayout profile modal', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetAuthStore()
  })

  it('opens the profile modal and submits a password change', async () => {
    const changePasswordSpy = vi
      .spyOn(authApi, 'changeUserPassword')
      .mockResolvedValue({ success: true, message: 'Password updated' })

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-profile',
          email: 'profile@example.com',
          first_name: 'Profile',
          last_name: 'User',
          plan: 'solo',
          role: 'owner',
          companyName: 'DSentr',
          oauthProvider: null
        },
        memberships: [],
        currentWorkspaceId: null
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    const user = userEvent.setup()

    await user.click(await screen.findByLabelText(/open profile/i))

    const dialog = await screen.findByRole('dialog', { name: /profile/i })
    expect(dialog).toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText(/current password/i),
      'old-password'
    )
    await user.type(
      within(dialog).getByLabelText(/^new password$/i),
      'new-password-123'
    )
    await user.type(
      within(dialog).getByLabelText(/confirm new password/i),
      'new-password-123'
    )

    await user.click(
      within(dialog).getByRole('button', { name: /change password/i })
    )

    await waitFor(() => {
      expect(changePasswordSpy).toHaveBeenCalledWith({
        currentPassword: 'old-password',
        newPassword: 'new-password-123'
      })
    })

    expect(within(dialog).getByText(/password updated/i)).toBeInTheDocument()

    changePasswordSpy.mockRestore()
  })

  it('disables password changes for Google or GitHub accounts', async () => {
    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'oauth-user',
          email: 'oauth@example.com',
          first_name: 'OAuth',
          last_name: 'User',
          plan: 'solo',
          role: 'owner',
          companyName: null,
          oauthProvider: 'google'
        },
        memberships: [],
        currentWorkspaceId: null
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    const user = userEvent.setup()
    await user.click(await screen.findByLabelText(/open profile/i))

    const dialog = await screen.findByRole('dialog', { name: /profile/i })
    expect(
      within(dialog).getByText(/password changes are managed/i)
    ).toBeInTheDocument()

    const submitButton = within(dialog).getByRole('button', {
      name: /change password/i
    })
    expect(submitButton).toBeDisabled()
    expect(within(dialog).getByLabelText(/current password/i)).toBeDisabled()
    expect(within(dialog).getByLabelText(/^new password$/i)).toBeDisabled()
    expect(
      within(dialog).getByLabelText(/confirm new password/i)
    ).toBeDisabled()
  })
})

describe('DashboardLayout pending invitations', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetAuthStore()
  })

  it('shows the pending invitation modal when invites are available', async () => {
    const invite = createInvite({
      workspace_id: 'workspace-new',
      workspace_name: 'Growth Team',
      token: 'token-1',
      id: 'invite-1'
    })
    listPendingInvitesSpy.mockResolvedValueOnce([invite])

    const membership = createMembership('workspace-a', 'Workspace A')

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-invite',
          email: 'invitee@example.com',
          first_name: 'Invitee',
          last_name: 'User',
          plan: 'workspace',
          role: 'admin',
          companyName: null,
          oauthProvider: null
        },
        memberships: [membership],
        currentWorkspaceId: 'workspace-a'
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(listPendingInvitesSpy).toHaveBeenCalled()
    })

    expect(
      await screen.findByRole('heading', {
        name: /confirm workspace invitation/i
      })
    ).toBeInTheDocument()
    expect(screen.getByText(/growth team/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument()
  })

  it('normalizes invitation status casing before filtering pending invites', async () => {
    const invite = {
      ...createInvite({
        workspace_id: 'workspace-case',
        workspace_name: 'Case Team',
        token: 'token-upper',
        id: 'invite-upper'
      }),
      status: 'PENDING' as unknown as WorkspaceInvitation['status']
    }
    listPendingInvitesSpy.mockResolvedValueOnce([invite])

    const membership = createMembership('workspace-a', 'Workspace A')

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-case',
          email: 'case@example.com',
          first_name: 'Case',
          last_name: 'Tester',
          plan: 'workspace',
          role: 'admin',
          companyName: null,
          oauthProvider: null
        },
        memberships: [membership],
        currentWorkspaceId: 'workspace-a'
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole('heading', {
        name: /confirm workspace invitation/i
      })
    ).toBeInTheDocument()
    expect(screen.getByText(/case team/i)).toBeInTheDocument()
  })

  it('accepts an invite, refreshes memberships, and advances the queue', async () => {
    const firstInvite = createInvite({
      id: 'invite-accept',
      token: 'token-accept',
      workspace_id: 'workspace-new',
      workspace_name: 'Growth Team'
    })
    const secondInvite = createInvite({
      id: 'invite-next',
      token: 'token-next',
      workspace_id: 'workspace-b',
      workspace_name: 'Data Squad'
    })
    listPendingInvitesSpy.mockResolvedValueOnce([firstInvite, secondInvite])

    const acceptSpy = vi
      .spyOn(workspaceApi, 'acceptInviteToken')
      .mockResolvedValue({ success: true, workspace_id: 'workspace-new' })

    const baseMembership = createMembership('workspace-a', 'Workspace A')
    const newMembership = createMembership('workspace-new', 'Growth Team')
    const refreshSpy = vi.fn(async () => {
      const memberships = [baseMembership, newMembership]
      useAuth.setState((state) => ({
        ...state,
        memberships
      }))
      return memberships
    })
    const setCurrentWorkspaceIdSpy = vi.fn((workspaceId: string) =>
      originalSetCurrentWorkspaceId(workspaceId)
    )

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-accept',
          email: 'accept@example.com',
          first_name: 'Accept',
          last_name: 'Tester',
          plan: 'workspace',
          role: 'admin',
          companyName: null,
          oauthProvider: null
        },
        memberships: [baseMembership],
        currentWorkspaceId: 'workspace-a',
        refreshMemberships: refreshSpy,
        setCurrentWorkspaceId: setCurrentWorkspaceIdSpy
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    const user = userEvent.setup()

    const acceptButton = await screen.findByRole('button', { name: /accept/i })
    await user.click(acceptButton)

    await waitFor(() => {
      expect(acceptSpy).toHaveBeenCalledWith('token-accept')
    })
    await waitFor(() => {
      expect(refreshSpy).toHaveBeenCalled()
    })
    expect(setCurrentWorkspaceIdSpy).toHaveBeenCalledWith('workspace-new')
    expect(screen.getByText(/invite accepted/i)).toBeInTheDocument()

    const continueButton = await screen.findByRole('button', {
      name: /continue/i
    })
    await user.click(continueButton)

    await waitFor(() => {
      expect(screen.getByText(/data squad/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/invite accepted/i)).not.toBeInTheDocument()
  })

  it('declines an invite and advances to the next pending invitation', async () => {
    const firstInvite = createInvite({
      id: 'invite-decline',
      token: 'token-decline',
      workspace_id: 'workspace-x',
      workspace_name: 'Ops Team'
    })
    const secondInvite = createInvite({
      id: 'invite-second',
      token: 'token-second',
      workspace_id: 'workspace-y',
      workspace_name: 'Platform Team'
    })
    listPendingInvitesSpy.mockResolvedValueOnce([firstInvite, secondInvite])

    const declineSpy = vi
      .spyOn(workspaceApi, 'declineInviteToken')
      .mockResolvedValue({ success: true, message: 'Invite declined' })
    const refreshSpy = vi.fn(async () => [])
    const setCurrentWorkspaceIdSpy = vi.fn((workspaceId: string) =>
      originalSetCurrentWorkspaceId(workspaceId)
    )

    const membership = createMembership('workspace-a', 'Workspace A')

    act(() => {
      useAuth.setState((state) => ({
        ...state,
        user: {
          id: 'user-decline',
          email: 'decline@example.com',
          first_name: 'Decline',
          last_name: 'Tester',
          plan: 'workspace',
          role: 'admin',
          companyName: null,
          oauthProvider: null
        },
        memberships: [membership],
        currentWorkspaceId: 'workspace-a',
        refreshMemberships: refreshSpy,
        setCurrentWorkspaceId: setCurrentWorkspaceIdSpy
      }))
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<div>Dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    const user = userEvent.setup()

    const declineButton = await screen.findByRole('button', {
      name: /decline/i
    })
    await user.click(declineButton)

    await waitFor(() => {
      expect(declineSpy).toHaveBeenCalledWith('token-decline')
    })
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(setCurrentWorkspaceIdSpy).not.toHaveBeenCalledWith('workspace-x')
    expect(screen.getByText(/invite declined/i)).toBeInTheDocument()

    const continueButton = await screen.findByRole('button', {
      name: /continue/i
    })
    await user.click(continueButton)

    await waitFor(() => {
      expect(screen.getByText(/platform team/i)).toBeInTheDocument()
    })
  })
})

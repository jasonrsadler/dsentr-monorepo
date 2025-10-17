import { useEffect } from 'react'
import { describe, beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import DashboardLayout from '../DashboardLayout'
import { useAuth } from '@/stores/auth'
import type { WorkspaceMembershipSummary } from '@/lib/orgWorkspaceApi'

type LocationLike = ReturnType<typeof useLocation>

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
          companyName: null
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
          companyName: null
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
          companyName: null
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
          companyName: null
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
    expect(within(header).getByText(/^Solo$/)).toBeInTheDocument()

    const switcher = await screen.findByLabelText(/workspace switcher/i)
    const userEventInstance = userEvent.setup()
    await userEventInstance.selectOptions(switcher, 'workspace-b')

    await waitFor(() => {
      expect(useAuth.getState().currentWorkspaceId).toBe('workspace-b')
    })

    expect(within(header).getByText(/^Workspace$/)).toBeInTheDocument()
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
          companyName: null
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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LogoutHandler from '@/Logout'

// Create manual mocks
const mockLogout = vi.fn()
const mockNavigate = vi.fn()

vi.mock('@/stores/auth', () => ({
  useAuth: (selector: any) => selector({ logout: mockLogout })
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate
  }
})

describe('<LogoutHandler />', () => {
  beforeEach(() => {
    mockLogout.mockReset()
    mockNavigate.mockReset()
  })

  it('calls logout and navigates to /login', () => {
    render(
      <MemoryRouter>
        <LogoutHandler />
      </MemoryRouter>
    )

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
  })
})

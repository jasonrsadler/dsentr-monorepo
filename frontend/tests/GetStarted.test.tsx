import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GetStarted from '@/GetStarted'

import { joinWaitlist } from '@/lib/waitlistApi'
import { Mock, vi } from 'vitest'

// Mock the joinWaitlist API
vi.mock('@/lib/waitlistApi', () => ({
  joinWaitlist: vi.fn()
}))

describe('GetStarted', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders the form initially', () => {
    render(<GetStarted />)
    expect(
      screen.getByRole('heading', { name: /be first to build/i })
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/you@example\.com/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /join waitlist/i })
    ).toBeInTheDocument()
  })

  it('submits the form and shows success message', async () => {
    ;(joinWaitlist as Mock).mockResolvedValueOnce(undefined)

    render(<GetStarted />)

    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: 'test@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /join waitlist/i }))

    await waitFor(() =>
      expect(
        screen.getByText(/you're in! we'll be in touch soon/i)
      ).toBeInTheDocument()
    )
  })

  it('shows error message on failure', async () => {
    ;(joinWaitlist as Mock).mockRejectedValueOnce(
      new Error('Something went wrong')
    )

    render(<GetStarted />)

    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: 'fail@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /join waitlist/i }))

    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    )
  })
})

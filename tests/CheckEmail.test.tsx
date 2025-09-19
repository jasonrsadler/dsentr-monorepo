import { render, screen } from '@testing-library/react'
import CheckEmail from '@/CheckEmail'

describe('CheckEmail', () => {
  it('renders confirmation message', () => {
    render(<CheckEmail />)

    expect(
      screen.getByRole('heading', { name: /check your email/i })
    ).toBeInTheDocument()

    expect(
      screen.getByText(/we've sent you a verification link/i)
    ).toBeInTheDocument()
  })
})

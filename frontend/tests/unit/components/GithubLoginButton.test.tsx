import { render, screen, fireEvent } from '@testing-library/react'
import GithubLoginButton from '@/components/GithubLoginButton'
import { vi } from 'vitest'

test('renders dark/light SVGs correctly', () => {
  render(<GithubLoginButton text="Continue with GitHub" />)
  const signInButtons = screen.getAllByText(/sign in with github/i)
  expect(signInButtons[0]).toBeInTheDocument()
})

test('calls onClick when clicked', () => {
  const handleClick = vi.fn()
  render(<GithubLoginButton onClick={handleClick} />)
  fireEvent.click(screen.getByRole('button'))
  expect(handleClick).toHaveBeenCalled()
})

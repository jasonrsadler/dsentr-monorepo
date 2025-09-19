import { render, screen, fireEvent } from '@testing-library/react'
import GoogleLoginButton from '@/components/GoogleLoginButton'
import { vi } from 'vitest'

test('renders Google login button', () => {
  render(<GoogleLoginButton />)
  // You can check for the button role
  expect(screen.getByRole('button')).toBeInTheDocument()
})

test('calls onClick when clicked', () => {
  const handleClick = vi.fn()
  render(<GoogleLoginButton onClick={handleClick} />)
  fireEvent.click(screen.getByRole('button'))
  expect(handleClick).toHaveBeenCalled()
})

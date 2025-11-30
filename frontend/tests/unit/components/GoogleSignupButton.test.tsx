import { render, screen, fireEvent } from '@testing-library/react'
import GoogleSignupButton from '@/components/GoogleSignupButton'
import { vi } from 'vitest'

test('renders Google signup button', () => {
  render(<GoogleSignupButton />)
  expect(screen.getByRole('button')).toBeInTheDocument()
})

test('calls onClick when clicked', () => {
  const handleClick = vi.fn()
  render(<GoogleSignupButton onClick={handleClick} />)
  fireEvent.click(screen.getByRole('button'))
  expect(handleClick).toHaveBeenCalled()
})

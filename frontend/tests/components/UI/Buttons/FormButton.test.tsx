import { render, screen } from '@testing-library/react'
import { FormButton } from '@/components/UI/Buttons/FormButton'

test('renders with children and type submit', () => {
  render(<FormButton>Click Me</FormButton>)
  const button = screen.getByRole('button', { name: /click me/i })
  expect(button).toHaveAttribute('type', 'submit')
})

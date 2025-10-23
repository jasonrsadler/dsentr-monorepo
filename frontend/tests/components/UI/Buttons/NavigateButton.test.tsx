import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NavigateButton } from '@/components/UI/Buttons/NavigateButton'

test('renders a link styled as a button', () => {
  render(
    <MemoryRouter>
      <NavigateButton to="/test">Go</NavigateButton>
    </MemoryRouter>
  )
  const link = screen.getByRole('link', { name: /go/i })
  expect(link).toHaveAttribute('href', '/test')
})

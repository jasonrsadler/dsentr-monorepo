import { render } from '@testing-library/react'
import ForgotPasswordIcon from '@/assets/svg-components/ForgotPasswordIcon' // adjust path as needed

describe('ForgotPasswordIcon', () => {
  it('renders the SVG element with correct attributes and classes', () => {
    const { container } = render(<ForgotPasswordIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('fill', 'none')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveClass(
      'mx-auto mb-4 h-16 w-16 text-indigo-600 dark:text-indigo-400'
    )
  })

  it('forwards extra props to the SVG element', () => {
    const { getByTestId } = render(<ForgotPasswordIcon data-testid="fp-icon" />)
    const svg = getByTestId('fp-icon')
    expect(svg).toBeInTheDocument()
  })
})

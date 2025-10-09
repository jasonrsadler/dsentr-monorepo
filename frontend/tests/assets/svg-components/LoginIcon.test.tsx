import { render } from '@testing-library/react'
import LoginIcon from '@/assets/svg-components/LoginIcon' // Adjust the import path as needed

describe('LoginIcon', () => {
  it('renders an SVG with expected attributes', () => {
    const { container } = render(<LoginIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('fill', 'none')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('stroke-width', '1.5')
  })

  it('forwards props to the SVG element', () => {
    const { getByTestId } = render(<LoginIcon data-testid="login-icon" />)
    const svg = getByTestId('login-icon')
    expect(svg).toBeInTheDocument()
  })
})

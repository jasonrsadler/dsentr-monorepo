import { render } from '@testing-library/react'
import LockIcon from '@/assets/svg-components/LockIcon' // Adjust import path if needed

describe('LockIcon', () => {
  it('renders an SVG with expected attributes', () => {
    const { container } = render(<LockIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('fill', 'none')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('stroke-width', '1.5')
  })

  it('forwards props to the SVG element', () => {
    const { getByTestId } = render(<LockIcon data-testid="clock-icon" />)
    const svg = getByTestId('clock-icon')
    expect(svg).toBeInTheDocument()
  })
})

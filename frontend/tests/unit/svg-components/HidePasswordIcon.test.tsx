import { render } from '@testing-library/react'
import HidePasswordIcon from '@/assets/svg-components/HidePasswordIcon' // Adjust path if needed

describe('HidePasswordIcon', () => {
  it('renders an SVG with expected attributes and classes', () => {
    const { container } = render(<HidePasswordIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('fill', 'none')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveClass('h-5 w-5')
  })

  it('forwards props to the SVG element', () => {
    const { getByTestId } = render(<HidePasswordIcon data-testid="hide-icon" />)
    const svg = getByTestId('hide-icon')
    expect(svg).toBeInTheDocument()
  })
})

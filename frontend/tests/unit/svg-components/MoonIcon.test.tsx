import { render } from '@testing-library/react'
import MoonIcon from '@/assets/svg-components/MoonIcon' // Update path if needed

describe('MoonIcon', () => {
  it('renders the moon icon SVG', () => {
    const { container } = render(<MoonIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelector('path')).toHaveAttribute(
      'd',
      'M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z'
    )
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(<MoonIcon className="custom-class" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('custom-class')
  })
})

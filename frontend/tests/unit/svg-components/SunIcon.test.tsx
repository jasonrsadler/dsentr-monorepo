import { render } from '@testing-library/react'
import SunIcon from '@/assets/svg-components/SunIcon' // adjust import path as needed

describe('SunIcon', () => {
  it('renders a sun SVG icon', () => {
    const { container } = render(<SunIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelector('circle')).toBeInTheDocument()
    expect(svg?.querySelectorAll('line').length).toBe(8) // 8 rays
  })

  it('applies custom className prop', () => {
    const { container } = render(<SunIcon className="custom-class" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('custom-class')
  })
})

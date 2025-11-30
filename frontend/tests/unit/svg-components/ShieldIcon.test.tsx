import { render } from '@testing-library/react'
import ShieldIcon from '@/assets/svg-components/ShieldIcon' // Adjust path as needed

describe('ShieldIcon', () => {
  it('renders the shield icon SVG', () => {
    const { container } = render(<ShieldIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelectorAll('path')).toHaveLength(1)
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(<ShieldIcon className="my-shield" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('my-shield')
  })
})

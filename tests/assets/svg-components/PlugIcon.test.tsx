import { render } from '@testing-library/react'
import PlugIcon from '@/assets/svg-components/PlugIcon' // Adjust path as needed

describe('PlugIcon', () => {
  it('renders the plug icon SVG', () => {
    const { container } = render(<PlugIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelectorAll('path')).toHaveLength(3)
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(<PlugIcon className="my-plug" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('my-plug')
  })
})

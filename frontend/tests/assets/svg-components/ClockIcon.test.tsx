import { render } from '@testing-library/react'
import ClockIcon from '@/assets/svg-components/ClockIcon'

describe('ClockIcon', () => {
  it('renders with default props', () => {
    const { container } = render(<ClockIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.classList.toString()).toMatch(/w-10 h-10/)
  })

  it('passes additional props to svg', () => {
    const { container } = render(<ClockIcon data-testid="clock" />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('data-testid', 'clock')
  })
})

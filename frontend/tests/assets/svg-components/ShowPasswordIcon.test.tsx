import { render } from '@testing-library/react'
import ShowPasswordIcon from '@/assets/svg-components/ShowPasswordIcon' // Adjust if needed

describe('ShowPasswordIcon', () => {
  it('renders the show password (eye) icon SVG', () => {
    const { container } = render(<ShowPasswordIcon />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelectorAll('path')).toHaveLength(2)
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(<ShowPasswordIcon className="visible-eye" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('visible-eye')
  })
})

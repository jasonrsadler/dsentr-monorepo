import { render } from '@testing-library/react'
import Email from '@/assets/svg-components/EmailIcon' // adjust the import path as needed

describe('Email icon', () => {
  it('renders the SVG element', () => {
    const { container } = render(<Email />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveClass(
      'w-24 h-24 mx-auto mb-6 text-indigo-500 dark:text-indigo-400'
    )
  })

  it('forwards additional props to the SVG', () => {
    const { getByTestId } = render(<Email data-testid="email-icon" />)
    const svg = getByTestId('email-icon')
    expect(svg).toBeInTheDocument()
  })
})

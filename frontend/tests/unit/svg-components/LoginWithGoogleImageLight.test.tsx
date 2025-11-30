import { render } from '@testing-library/react'
import LoginWithGoogleImageLight from '@/assets/svg-components/LoginWithGoogleImageLight' // Update path if needed

describe('LoginWithGoogleImageLight', () => {
  it('renders the light Google login button SVG', () => {
    const { container } = render(<LoginWithGoogleImageLight />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 448 42')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
    expect(container.textContent).toContain('Sign in with Google')
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(
      <LoginWithGoogleImageLight className="test-light" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('test-light')
  })
})

import { render } from '@testing-library/react'
import LoginWithGoogleImageDark from '@/assets/svg-components/LoginWithGoogleImageDark' // Update path if needed

describe('LoginWithGoogleImageDark', () => {
  it('renders the dark Google login button SVG', () => {
    const { container } = render(<LoginWithGoogleImageDark />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 448 42')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
    expect(container.textContent).toContain('Sign in with Google')
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(
      <LoginWithGoogleImageDark className="test-dark" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('test-dark')
  })
})

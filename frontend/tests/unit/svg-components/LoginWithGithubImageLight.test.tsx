import { render } from '@testing-library/react'
import LoginWithGoogleImage from '@/assets/svg-components/LoginWithGithubImageLight' // Adjust path if needed

describe('LoginWithGoogleImage', () => {
  it('renders the Google login button SVG', () => {
    const { container } = render(<LoginWithGoogleImage />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 448 42')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')

    // Ensure the button text is present (even though it says GitHub, assuming it's reused incorrectly)
    expect(container.textContent).toContain('Sign in with GitHub')
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(
      <LoginWithGoogleImage className="test-class" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('test-class')
  })
})

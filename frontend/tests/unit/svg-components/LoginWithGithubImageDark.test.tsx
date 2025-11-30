import { render } from '@testing-library/react'
import LoginWithGitHubImageDark from '@/assets/svg-components/LoginWithGithubImageDark' // Adjust import if needed

describe('LoginWithGitHubImage', () => {
  it('renders the GitHub login button SVG', () => {
    const { container } = render(<LoginWithGitHubImageDark />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 448 42')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')

    // Make sure GitHub icon and text are present
    const innerSvgs = container.querySelectorAll('svg')
    expect(innerSvgs.length).toBeGreaterThan(1) // outer + inner GitHub logo
    expect(container.textContent).toContain('Sign in with GitHub')
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(
      <LoginWithGitHubImageDark className="test-class" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('test-class')
  })
})

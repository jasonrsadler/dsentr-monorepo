import { render } from '@testing-library/react'
import SignupWithGitHubImageDark from '@/assets/svg-components/SignupWithGithubImageDark' // Adjust path as needed

describe('SignupWithGitHubImageDark', () => {
  it('renders the dark GitHub signup button SVG', () => {
    const { container } = render(<SignupWithGitHubImageDark />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 448 42')
    expect(container.textContent).toContain('Sign up with GitHub')
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(
      <SignupWithGitHubImageDark className="dark-button" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('dark-button')
  })
})

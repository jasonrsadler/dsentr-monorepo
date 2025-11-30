import { render } from '@testing-library/react'
import SignupWithGithubImageLight from '@/assets/svg-components/SignupWithGithubImageLight' // Adjust path as needed

describe('SignupWithGithubImageLight', () => {
  it('renders the light GitHub signup button SVG', () => {
    const { container } = render(<SignupWithGithubImageLight />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 448 42')
    expect(container.textContent).toContain('Sign up with GitHub')
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(
      <SignupWithGithubImageLight className="light-button" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('light-button')
  })
})

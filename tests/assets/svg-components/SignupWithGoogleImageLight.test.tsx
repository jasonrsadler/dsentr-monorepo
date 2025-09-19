import { render } from '@testing-library/react'
import SignupWithGoogleImageLight from '@/assets/svg-components/SignupWithGoogleImageLight' // adjust path

describe('SignupWithGoogleImageLight', () => {
  it('renders the light Google signup button SVG', () => {
    const { container } = render(<SignupWithGoogleImageLight />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 448 42')
    expect(container.textContent).toContain('Sign up with Google')
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(
      <SignupWithGoogleImageLight className="google-light-button" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('google-light-button')
  })
})

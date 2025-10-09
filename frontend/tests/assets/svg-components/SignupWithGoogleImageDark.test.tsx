import { render } from '@testing-library/react'
import SignupWithGoogleImageDark from '@/assets/svg-components/SignupWithGoogleImageDark' // Adjust path as needed

describe('SignupWithGoogleImageDark', () => {
  it('renders the dark Google signup button SVG', () => {
    const { container } = render(<SignupWithGoogleImageDark />)
    const svg = container.querySelector('svg')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 448 42')
    expect(container.textContent).toContain('Sign up with Google')
  })

  it('forwards className prop to outer SVG', () => {
    const { container } = render(
      <SignupWithGoogleImageDark className="google-dark-button" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('google-dark-button')
  })
})

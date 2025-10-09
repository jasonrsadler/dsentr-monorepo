// src/__tests__/About.test.tsx
import { render, screen } from '@testing-library/react'
import About from '@/About'

describe('About page', () => {
  it('renders the main heading with Dsentr', () => {
    render(<About />)
    expect(
      screen.getByRole('heading', { name: /About Dsentr/i })
    ).toBeInTheDocument()
  })

  it('renders all three sections', () => {
    render(<About />)

    expect(
      screen.getByRole('heading', { name: /Our Mission/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Our Vision/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Our Principles/i })
    ).toBeInTheDocument()
  })

  it('renders the story section', () => {
    render(<About />)

    expect(
      screen.getByRole('heading', { name: /The Story Behind Dsentr/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Dsentr began as a personal frustration/i)
    ).toBeInTheDocument()
  })
})

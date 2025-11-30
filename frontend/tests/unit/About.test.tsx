// src/__tests__/About.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import About from '@/About'

describe('About page', () => {
  it('renders the main heading with DSentr', () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('heading', { name: /About DSentr/i })
    ).toBeInTheDocument()
  })

  it('renders all three sections', () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>
    )

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
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>
    )

    expect(
      screen.getByRole('heading', { name: /The Story Behind DSentr/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/DSentr began as a personal frustration/i)
    ).toBeInTheDocument()
  })
})

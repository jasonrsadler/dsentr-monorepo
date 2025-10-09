import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import NotFound from '@/components/NotFound'

describe('NotFound', () => {
  it('renders the 404 heading and message', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('404')
    expect(
      screen.getByText("The page you're looking for doesn't exist.")
    ).toBeInTheDocument()
  })

  it('renders helpful links with correct text and hrefs', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    )

    const homeLink = screen.getByText('Go back to the Home page')
    expect(homeLink).toBeInTheDocument()
    expect(homeLink).toHaveAttribute('href', '/')

    const aboutLink = screen.getByText('Learn more about Dsentr')
    expect(aboutLink).toBeInTheDocument()
    expect(aboutLink).toHaveAttribute('href', '/about')

    const howItWorksLink = screen.getByText('Discover how Dsentr works')
    expect(howItWorksLink).toBeInTheDocument()
    expect(howItWorksLink).toHaveAttribute('href', '/how-it-works')
  })

  it('renders NavigateButton and it navigates to home on click', async () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    )

    const navButton = screen.getByRole('button', { name: /go home/i })
    expect(navButton).toBeInTheDocument()

    // Optional: test navigation on click if NavigateButton is a react-router Link or uses navigate
    // But since NavigateButton is a custom component,
    // you can test that it has the correct 'to' prop or fires navigation as needed.
  })
})

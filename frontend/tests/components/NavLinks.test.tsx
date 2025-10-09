import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { NavLinks } from '@/components/NavLinks'

describe('NavLinks', () => {
  it('renders all nav links with correct text', () => {
    render(
      <MemoryRouter>
        <NavLinks />
      </MemoryRouter>
    )

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
    expect(screen.getByText('How it works')).toBeInTheDocument()
  })

  it('applies active class to the Home link when on / route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavLinks />
      </MemoryRouter>
    )

    const homeLink = screen.getByText('Home')
    expect(homeLink).toHaveClass('font-semibold')
    expect(homeLink).toHaveClass('text-primary')

    const aboutLink = screen.getByText('About')
    expect(aboutLink).not.toHaveClass('font-semibold')
    expect(aboutLink).toHaveClass('text-white')
  })

  it('applies active class to the About link when on /about route', () => {
    render(
      <MemoryRouter initialEntries={['/about']}>
        <NavLinks />
      </MemoryRouter>
    )

    const aboutLink = screen.getByText('About')
    expect(aboutLink).toHaveClass('font-semibold')
    expect(aboutLink).toHaveClass('text-primary')

    const homeLink = screen.getByText('Home')
    expect(homeLink).not.toHaveClass('font-semibold')
    expect(homeLink).toHaveClass('text-white')
  })

  it('applies active class to the How it works link when on /how-it-works route', () => {
    render(
      <MemoryRouter initialEntries={['/how-it-works']}>
        <NavLinks />
      </MemoryRouter>
    )

    const hiwLink = screen.getByText('How it works')
    expect(hiwLink).toHaveClass('font-semibold')
    expect(hiwLink).toHaveClass('text-primary')

    const homeLink = screen.getByText('Home')
    expect(homeLink).not.toHaveClass('font-semibold')
    expect(homeLink).toHaveClass('text-white')
  })
})

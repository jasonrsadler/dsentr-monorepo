import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from '@/Home'

describe('Home', () => {
  beforeEach(() => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )
  })

  it('renders main heading', () => {
    expect(
      screen.getByRole('heading', {
        name: /automate your work with modular logic/i
      })
    ).toBeInTheDocument()
  })

  it('renders intro paragraph', () => {
    expect(
      screen.getByText(/Dsentr is a modular no-code automation platform/i)
    ).toBeInTheDocument()
  })

  it('has a Get Started button linking to /get-started', () => {
    const button = screen.getByRole('link', { name: /get started/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('href', '/get-started')
  })

  it('renders all three feature headings and descriptions', () => {
    expect(
      screen.getByRole('heading', { name: /modular by design/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/pluggable components that fit your logic/i)
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: /trigger-driven/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/schedule tasks, respond to webhooks/i)
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: /secure & scalable/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/built with robust architecture/i)
    ).toBeInTheDocument()
  })
})

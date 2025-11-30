import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HowItWorks from '@/HowItWorks'

describe('HowItWorks', () => {
  beforeEach(() => {
    render(
      <MemoryRouter>
        <HowItWorks />
      </MemoryRouter>
    )
  })

  it('renders the page heading', () => {
    expect(
      screen.getByRole('heading', { name: /how dsentr works/i })
    ).toBeInTheDocument()
  })

  it('renders the Modular Plugin System section', () => {
    expect(
      screen.getByRole('heading', { name: /modular plugin system/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/powered by a dynamic plugin architecture/i)
    ).toBeInTheDocument()
  })

  it('renders the Workflow Builder section', () => {
    expect(
      screen.getByRole('heading', { name: /workflow builder/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/build powerful automations by chaining plugins/i)
    ).toBeInTheDocument()
  })

  it('renders the Execution Engine section', () => {
    expect(
      screen.getByRole('heading', { name: /execution engine/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/our engine runs workflows step-by-step/i)
    ).toBeInTheDocument()
  })

  it('renders the Web UI section', () => {
    expect(screen.getByRole('heading', { name: /web ui/i })).toBeInTheDocument()
    expect(
      screen.getByText(/our clean interface makes it easy to build/i)
    ).toBeInTheDocument()
  })

  it('renders the Try Now button linking to /signup', () => {
    const button = screen.getByRole('link', { name: /try now/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('href', '/signup')
  })
})

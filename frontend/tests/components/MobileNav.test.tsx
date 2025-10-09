import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileNav } from '@/components/MobileNav'

describe('MobileNav', () => {
  it('renders toggle button and menu is closed initially', () => {
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>
    )

    expect(
      screen.getByRole('button', { name: /toggle menu/i })
    ).toBeInTheDocument()
    // Menu should be closed so nav links are not visible
    expect(screen.queryByText(/home/i)).not.toBeInTheDocument()
  })

  it('opens menu when toggle button clicked', () => {
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>
    )
    const toggleButton = screen.getByRole('button', { name: /toggle menu/i })
    fireEvent.click(toggleButton)

    expect(screen.getByText(/home/i)).toBeVisible()
    expect(screen.getByText(/about/i)).toBeVisible()
    expect(screen.getByText(/how it works/i)).toBeVisible()
  })

  it('closes menu when toggle button clicked again', () => {
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>
    )
    const toggleButton = screen.getByRole('button', { name: /toggle menu/i })
    fireEvent.click(toggleButton) // open
    fireEvent.click(toggleButton) // close

    expect(screen.queryByText(/home/i)).not.toBeInTheDocument()
  })

  it('closes menu when a nav link is clicked', () => {
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: /toggle menu/i })) // open

    const homeLink = screen.getByText(/home/i)
    fireEvent.click(homeLink)

    expect(screen.queryByText(/home/i)).not.toBeInTheDocument()
  })
})

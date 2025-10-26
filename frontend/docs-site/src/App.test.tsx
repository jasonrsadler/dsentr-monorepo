import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import App from './App'

describe('App', () => {
  it('renders the hero headline', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )

    expect(
      screen.getByRole('heading', { name: /dsentr documentation/i })
    ).toBeInTheDocument()
  })
})

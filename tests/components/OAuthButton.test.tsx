import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OAuthButton } from '@/components/OAuthButton'

describe('OAuthButton', () => {
  const defaultLabels = {
    google: 'Continue with Google',
    github: 'Continue with GitHub'
  }

  it('renders with default label and icon for each provider', () => {
    ;(Object.keys(defaultLabels) as Array<keyof typeof defaultLabels>).forEach(
      (provider) => {
        const { unmount } = render(<OAuthButton provider={provider} />)

        expect(screen.getByRole('button')).toHaveTextContent(
          defaultLabels[provider]
        )

        const img = screen.getByRole('img', { name: `${provider} logo` })
        expect(img).toHaveAttribute('src', `/icons/${provider}.svg`)

        unmount()
      }
    )
  })

  it('renders with custom label if provided', () => {
    render(<OAuthButton provider="google" label="Sign in with Google" />)
    expect(screen.getByRole('button')).toHaveTextContent('Sign in with Google')
  })

  it('calls onClick handler when clicked', () => {
    const onClick = vi.fn()
    render(<OAuthButton provider="github" onClick={onClick} />)

    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

// src/tests/hooks/usePageMeta.test.tsx
import { describe, it, beforeEach, expect } from 'vitest'
import { render } from '@testing-library/react'
import { usePageMeta } from '@/hooks/usePageMeta'

type PageMetaOptions = Parameters<typeof usePageMeta>[0]

function TestComponent(props: PageMetaOptions) {
  usePageMeta(props)
  return null
}

describe('usePageMeta', () => {
  beforeEach(() => {
    document.title = ''
    document.head.innerHTML = ''
  })

  it('sets document title and meta tags', () => {
    render(
      <TestComponent
        title="Test Title"
        description="Test description"
        image="https://example.com/image.png"
        url="https://example.com"
      />
    )

    expect(document.title).toBe('Test Title')

    const metas = [
      ['description', 'Test description'],
      ['og:description', 'Test description'],
      ['og:title', 'Test Title'],
      ['og:image', 'https://example.com/image.png'],
      ['og:url', 'https://example.com'],
      ['og:type', 'website']
    ]

    for (const [name, value] of metas) {
      const meta = document.querySelector(
        `meta[name="${name}"], meta[property="${name}"]`
      )
      expect(meta).not.toBeNull()
      expect(meta?.getAttribute('content')).toBe(value)
    }
  })

  it('only sets what is provided', () => {
    render(<TestComponent title="Only Title" />)

    expect(document.title).toBe('Only Title')
    expect(
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content')
    ).toBe('Only Title')

    expect(document.querySelector('meta[name="description"]')).toBeNull()
    expect(document.querySelector('meta[property="og:image"]')).toBeNull()
  })

  it('updates existing meta tags instead of duplicating', () => {
    const existing = document.createElement('meta')
    existing.setAttribute('name', 'description')
    existing.setAttribute('content', 'Old description')
    document.head.appendChild(existing)

    render(<TestComponent description="Updated description" />)

    const updated = document.querySelector('meta[name="description"]')
    expect(updated?.getAttribute('content')).toBe('Updated description')
  })
})

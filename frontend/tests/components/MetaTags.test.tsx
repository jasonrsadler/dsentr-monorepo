import { render } from '@testing-library/react'
import { MetaTags } from '@/components/MetaTags'

describe('MetaTags', () => {
  beforeEach(() => {
    // Clean up document head meta tags before each test
    document.head.innerHTML = ''
    document.title = ''
  })

  test('sets document title and meta tags with default props', () => {
    render(<MetaTags />)

    expect(document.title).toBe('Dsentr – Visual Automation for Everyone')
    expect(
      (document.querySelector('meta[name="description"]') as HTMLMetaElement)
        ?.content
    ).toBe('Build and run powerful no-code workflows with Dsentr.')
    expect(
      (document.querySelector('meta[property="og:title"]') as HTMLMetaElement)
        ?.content
    ).toBe('Dsentr – Visual Automation for Everyone')
    expect(
      (document.querySelector('meta[name="twitter:card"]') as HTMLMetaElement)
        ?.content
    ).toBe('summary_large_image')
  })

  test('updates meta tags when props change', () => {
    const { rerender } = render(
      <MetaTags title="Custom Title" description="Custom description" />
    )
    expect(document.title).toBe('Custom Title')
    expect(
      (document.querySelector('meta[name="description"]') as HTMLMetaElement)
        ?.content
    ).toBe('Custom description')

    rerender(<MetaTags title="Another Title" />)
    expect(document.title).toBe('Another Title')
  })
})

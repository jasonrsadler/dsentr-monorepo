import { useEffect } from 'react'

type MetaTagsProps = {
  title?: string
  description?: string
  image?: string
  url?: string
}

export function MetaTags({
  title = 'DSentr – Visual Automation for Everyone',
  description = 'Build and run powerful no-code workflows with DSentr.',
  image = '/og-preview.svg',
  url = 'https://dsentr.com'
}: MetaTagsProps) {
  useEffect(() => {
    document.title = title

    const updateMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute('name', name)
        document.head.appendChild(el)
      }
      el.setAttribute('content', content)
    }

    const updateProperty = (property: string, content: string) => {
      let el = document.querySelector(
        `meta[property="${property}"]`
      ) as HTMLMetaElement
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute('property', property)
        document.head.appendChild(el)
      }
      el.setAttribute('content', content)
    }

    updateMeta('description', description)
    updateMeta('twitter:card', 'summary_large_image')
    updateMeta('twitter:title', title)
    updateMeta('twitter:description', description)
    updateMeta('twitter:image', image)

    updateProperty('og:title', title)
    updateProperty('og:description', description)
    updateProperty('og:image', image)
    updateProperty('og:type', 'website')
    updateProperty('og:url', url)
  }, [title, description, image, url])

  return null
}

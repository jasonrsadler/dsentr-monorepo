// src/hooks/usePageMeta.ts
import { useEffect } from 'react'

interface PageMetaOptions {
  title?: string
  description?: string
  image?: string // URL to your Open Graph preview image
  url?: string // Canonical URL of the page
}

export function usePageMeta({
  title,
  description,
  image,
  url
}: PageMetaOptions) {
  useEffect(() => {
    if (title) {
      document.title = title
      setMeta('og:title', title)
    }

    if (description) {
      setMeta('description', description)
      setMeta('og:description', description)
    }

    if (url) {
      setMeta('og:url', url)
    }

    if (image) {
      setMeta('og:image', image)
    }

    // Set general OG type
    setMeta('og:type', 'website')
  }, [title, description, image, url])
}

function setMeta(property: string, content: string) {
  let element = document.querySelector(
    `meta[name="${property}"], meta[property="${property}"]`
  )
  if (!element) {
    element = document.createElement('meta')
    if (property.startsWith('og:')) {
      element.setAttribute('property', property)
    } else {
      element.setAttribute('name', property)
    }
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

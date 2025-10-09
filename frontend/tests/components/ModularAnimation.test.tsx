import { render } from '@testing-library/react'
import ModularAnimation from '@/components/ModularAnimation'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('ModularAnimation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

    const { unmount } = render(<ModularAnimation />)
    unmount()

    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})

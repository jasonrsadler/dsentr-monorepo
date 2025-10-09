import { useRef, useCallback } from 'react'

export function useDebouncedNodeUpdate<T>(
  onUpdate: (data: T) => void,
  delay = 200
) {
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  return useCallback(
    (data: T) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onUpdate(data)
      }, delay)
    },
    [onUpdate, delay]
  )
}

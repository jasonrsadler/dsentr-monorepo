import { useState, useEffect, useRef } from 'react'

interface NodeInputFieldProps {
  type?: string
  placeholder?: string
  value?: string
  onChange: (value: string) => void
  className?: string
  maxchars?: number
}

export default function NodeInputField({
  type = 'text',
  placeholder = '',
  value,
  onChange,
  className,
  maxchars
}: NodeInputFieldProps) {
  const [internalValue, setInternalValue] = useState(value ?? '')
  const latestValue = useRef(value ?? '')
  const lastEmittedRef = useRef<string>(value ?? '')
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (value !== latestValue.current) {
      latestValue.current = value ?? ''
      lastEmittedRef.current = value ?? ''
      setInternalValue(value ?? '')
    }
  }, [value])

  const isTestEnv =
    typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test'

  const handleChange = (val: string) => {
    let sanitized: string
    if (type === 'number') {
      sanitized = val.replace(/[^\d]/g, '').slice(0, 15)
    } else {
      sanitized = val.slice(0, maxchars ?? 1000)
    }

    setInternalValue(sanitized)
    latestValue.current = sanitized

    if (sanitized === lastEmittedRef.current) {
      return
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(
      () => {
        lastEmittedRef.current = sanitized
        onChange(sanitized)
      },
      isTestEnv ? 0 : 250
    )
  }

  const inputClass =
    'text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-zinc-500 nodrag'

  return (
    <input
      type={type}
      placeholder={placeholder}
      className={className ?? inputClass}
      value={internalValue}
      onChange={(e) => handleChange(e.target.value)}
    />
  )
}

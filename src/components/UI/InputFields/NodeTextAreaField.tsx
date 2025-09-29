import { useState, useEffect, useRef } from "react"

interface NodeTextAreaFieldProps {
  placeholder?: string
  value?: string
  onChange: (value: string) => void
  className?: string
  maxchars?: number
  rows?: number
}

export default function NodeTextAreaField({
  placeholder = "",
  value = "",
  onChange,
  className,
  maxchars,
  rows = 4
}: NodeTextAreaFieldProps) {
  const [internalValue, setInternalValue] = useState(value)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setInternalValue(value)
  }, [value])

  const handleChange = (val: string) => {
    const sanitized = val.slice(0, maxchars ?? 30000)
    setInternalValue(sanitized)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      onChange(sanitized)
    }, 750)
  }

  const textAreaClass =
    "text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-zinc-500 nodrag"

  return (
    <textarea
      placeholder={placeholder}
      className={className ?? textAreaClass}
      value={internalValue}
      onChange={e => handleChange(e.target.value)}
      rows={rows}
    />
  )
}

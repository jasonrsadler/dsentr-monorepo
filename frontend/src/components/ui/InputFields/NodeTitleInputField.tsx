import { useState, useEffect, useRef } from 'react'

interface NodeTitleInputFieldProps {
  label: string
  dirty: boolean
  hasValidationErrors?: boolean
  onLabelChange: (label: string) => void
  maxchars?: number
  debounceMs?: number
}

export default function NodeTitleInputField({
  label,
  dirty,
  hasValidationErrors,
  onLabelChange,
  maxchars = 24
}: NodeTitleInputFieldProps) {
  const [editing, setEditing] = useState(false)
  const [internalLabel, setInternalLabel] = useState(label)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setInternalLabel(label)
  }, [label])

  const handleChange = (val: string) => {
    const sanitized = val.slice(0, maxchars)
    setInternalLabel(sanitized)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      onLabelChange(sanitized)
    }, 750)
  }

  const inputClass =
    'text-sm font-semibold bg-transparent border-b border-zinc-400 focus:outline-none w-full'
  const labelClass = 'text-sm font-semibold cursor-pointer relative'

  return (
    <>
      {editing ? (
        <input
          value={internalLabel}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          className={inputClass}
        />
      ) : (
        <h3 onDoubleClick={() => setEditing(true)} className={labelClass}>
          {internalLabel}
          {(dirty || hasValidationErrors) && (
            <span className="absolute -right-3 top-1 w-2 h-2 rounded-full bg-blue-500" />
          )}
        </h3>
      )}
    </>
  )
}

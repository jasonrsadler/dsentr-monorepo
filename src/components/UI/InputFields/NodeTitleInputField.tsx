import { useState } from "react";

interface NodeTitleInputFieldProps {
  label: string;
  dirty: boolean;
  hasValidationErrors?: boolean;
  onLabelChange: (label: string) => void
}

export default function NodeTitleInputField({ label, dirty, hasValidationErrors, onLabelChange }: NodeTitleInputFieldProps) {
  const [editing, setEditing] = useState(false)
  const inputClass = "text-sm font-semibold bg-transparent border-b border-zinc-400 focus:outline-none w-full"
  const labelClass = "text-sm font-semibold cursor-pointer relative"
  return (
    <>
      {
        editing ? (
          <input
            value={label}
            onChange={e => onLabelChange(e.target.value)}
            onBlur={
              () => {
                setEditing(false)
              }
            }
            onKeyDown={
              e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  e.currentTarget.blur()  // triggers onBlur
                }
              }
            }
            className={inputClass}
          />
        ) : (
          <h3 onDoubleClick={() => setEditing(true)}
            className={labelClass}
          >
            {label}{(dirty || hasValidationErrors) && (<span className="absolute -right-3 top-1 w-2 h-2 rounded-full bg-blue-500" />)}
          </h3>
        )}
    </>
  )
}
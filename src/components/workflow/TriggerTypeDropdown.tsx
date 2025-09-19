import { useState } from "react"

const triggerTypes = ["Manual", "Webhook", "Schedule"]

export default function TriggerTypeDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)

  const handleSelect = (type) => {
    onChange(type)
    setOpen(false)
  }

  return (
    <div className="relative inline-block w-full text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left px-2 py-1 border rounded bg-zinc-50 dark:bg-zinc-800"
      >
        {value}
      </button>
      {open && (
        <ul className="absolute z-10 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-32 overflow-auto">
          {triggerTypes.map((type) => (
            <li
              key={type}
              onClick={() => handleSelect(type)}
              className="px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              {type}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

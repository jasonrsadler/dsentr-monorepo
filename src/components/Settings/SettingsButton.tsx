import { useState, useRef, useEffect } from 'react'
import { Settings } from 'lucide-react'

type Props = {
  onOpenSettings: () => void
}

export default function SettingsButton({ onOpenSettings }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Open settings menu"
        className="p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
        onClick={() => setOpen((v) => !v)}
      >
        <Settings size={18} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded shadow">
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            Settings
          </button>
        </div>
      )}
    </div>
  )}


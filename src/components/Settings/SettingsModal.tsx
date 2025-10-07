import { useState } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  tabs: Array<{ key: string; label: string }>
  renderTab: (key: string) => JSX.Element
  initialTab?: string
}

export default function SettingsModal({ open, onClose, tabs, renderTab, initialTab }: Props) {
  const [active, setActive] = useState(initialTab ?? tabs[0]?.key)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-[900px] h-[600px] flex border border-zinc-200 dark:border-zinc-700">
        <aside className="w-56 border-r border-zinc-200 dark:border-zinc-700 p-4">
          <h2 className="font-semibold mb-3">Settings</h2>
          <nav className="space-y-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`w-full text-left px-3 py-2 rounded ${active === t.key ? 'bg-zinc-200 dark:bg-zinc-700' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                onClick={() => setActive(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </aside>
        <section className="flex-1 p-4 overflow-auto">
          {renderTab(active)}
        </section>
        <button className="absolute top-2 right-3 text-sm text-zinc-600 dark:text-zinc-300 hover:underline" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}


import {
  ComponentType,
  SVGProps,
  useEffect,
  useState,
  type ReactNode
} from 'react'

type SettingsIcon = ComponentType<SVGProps<SVGSVGElement>>

type Props = {
  open: boolean
  onClose: () => void
  tabs: Array<{ key: string; label: string; icon?: SettingsIcon }>
  renderTab: (key: string) => ReactNode
  initialTab?: string
}

export default function SettingsModal({
  open,
  onClose,
  tabs,
  renderTab,
  initialTab
}: Props) {
  const [active, setActive] = useState(initialTab ?? tabs[0]?.key)

  useEffect(() => {
    if (!open) return
    if (initialTab) {
      setActive(initialTab)
    } else {
      setActive((prev) => prev ?? tabs[0]?.key)
    }
  }, [open, initialTab, tabs])
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-[900px] h-[600px] flex border border-zinc-200 dark:border-zinc-700">
        <aside className="w-56 border-r border-zinc-200 dark:border-zinc-700 p-4">
          <h2 className="font-semibold mb-3">Settings</h2>
          <nav className="space-y-1">
            {tabs.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.key}
                  className={`w-full text-left px-3 py-2 rounded flex items-center gap-2 ${
                    active === t.key
                      ? 'bg-zinc-200 dark:bg-zinc-700'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  onClick={() => setActive(t.key)}
                >
                  {Icon && <Icon className="size-4 shrink-0" />}
                  <span>{t.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>
        <section className="flex-1 p-4 overflow-auto themed-scroll">
          {renderTab(active)}
        </section>
        <button
          className="absolute top-2 right-3 text-sm text-zinc-600 dark:text-zinc-300 hover:underline"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  )
}

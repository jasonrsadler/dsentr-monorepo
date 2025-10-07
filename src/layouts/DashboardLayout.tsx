// src/layouts/DashboardLayout.tsx
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { NavigateButton } from '@/components/UI/Buttons/NavigateButton'
import { useAuth } from '@/stores/auth'
import SettingsButton from '@/components/Settings/SettingsButton'
import SettingsModal from '@/components/Settings/SettingsModal'
import WorkflowsTab from '@/components/Settings/tabs/WorkflowsTab'
import LogsTab from '@/components/Settings/tabs/LogsTab'
import { DsentrLogo } from '@/components/DsentrLogo'

export default function DashboardLayout() {
  const { user } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Preferences removed

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-1 font-bold tracking-tight text-xl text-zinc-900 dark:text-zinc-100">
          <span className="leading-none">Dsentr</span>
          <span className="inline-block align-middle" style={{ height: '1em' }}>
            <DsentrLogo className="w-[1.5em] h-[1.5em]" />
          </span>
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-300 leading-none">
              {user.first_name} {user.last_name}
            </span>
            <NavigateButton to="/logout" className="px-3 py-2 text-sm leading-none h-9">
              Log out
            </NavigateButton>
            <ThemeToggle />
            <SettingsButton onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        )}
      </header>

      <main className="flex-1 bg-zinc-50 dark:bg-zinc-800">
        <Outlet />
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tabs={[
          { key: 'workflows', label: 'Workflows' },
          { key: 'logs', label: 'Logs' },
        ]}
        renderTab={(key) => {
          if (key === 'workflows') return <WorkflowsTab />
          if (key === 'logs') return <LogsTab />
          return <div />
        }}
      />
    </div>
  )
}

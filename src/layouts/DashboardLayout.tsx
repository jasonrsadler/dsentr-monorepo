// src/layouts/DashboardLayout.tsx
import { Outlet } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { NavigateButton } from '@/components/UI/Buttons/NavigateButton'
import { useAuth } from '@/stores/auth'

export default function DashboardLayout() {
  const { user } = useAuth()
  return (
    <div className="min-h-screen flex">

      <main className="flex-1 p-6 bg-zinc-50 dark:bg-zinc-800">
        <div className="flex justify-end mb-4">
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-600 dark:text-zinc-300 leading-none">
                {user.first_name} {user.last_name}
              </span>
              <NavigateButton to="/logout" className="px-3 py-2 text-sm leading-none h-9">
                Log out
              </NavigateButton>
              <ThemeToggle />
            </div>
          )}
        </div>
        <Outlet />
      </main>
    </div>
  )
}

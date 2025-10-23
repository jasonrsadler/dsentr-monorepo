// src/layouts/PublicLayout.tsx
import { Outlet } from 'react-router-dom'
import { NavLinks } from '@/components/NavLinks'
import { ThemeToggle } from '@/components/ThemeToggle'
import { MobileNav } from '@/components/MobileNav'
import { NavigateButton } from '@/components/UI/Buttons/NavigateButton'
import { DsentrLogo } from '@/components/DsentrLogo'
import { useAuth } from '@/stores/auth'

export default function PublicLayout() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex justify-between items-center px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-1 font-bold tracking-tight text-xl text-zinc-900 dark:text-zinc-100">
          <span className="leading-none">Dsentr</span>
          <span className="inline-block align-middle" style={{ height: '1em' }}>
            <DsentrLogo className="w-[1.5em] h-[1.5em]" />
          </span>
        </div>

        {user ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-300 leading-none">
              {user.first_name} {user.last_name}
            </span>
            <NavigateButton
              to="/logout"
              className="px-3 py-2 text-sm leading-none h-9"
            >
              Log out
            </NavigateButton>
            <ThemeToggle />
          </div>
        ) : (
          <div className="hidden md:flex gap-4 items-center">
            <NavLinks />
            <NavigateButton
              to="/login"
              className="px-3 py-2 text-sm leading-none h-9"
            >
              Log in
            </NavigateButton>
            <NavigateButton
              to="/signup"
              className="px-3 py-2 text-sm leading-none h-9"
            >
              Sign Up
            </NavigateButton>
            <ThemeToggle />
          </div>
        )}

        <div className="md:hidden">
          <MobileNav />
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="text-center py-6 text-sm text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-700">
        &copy; {new Date().getFullYear()} Dsentr. All rights reserved.
      </footer>
    </div>
  )
}

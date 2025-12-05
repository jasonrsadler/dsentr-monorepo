// src/components/MobileNav.tsx
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

export function MobileNav() {
  const [open, setOpen] = useState(false)

  const linkClass =
    'block rounded-lg px-4 py-3 text-base font-semibold transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-100'
  const activeClass =
    'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-100'

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-zinc-700 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400"
        aria-label="Toggle Menu"
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {open && (
        <div className="absolute top-14 left-0 w-full bg-white dark:bg-zinc-900 shadow-md border-t border-zinc-200 dark:border-zinc-700 z-50">
          <nav className="flex flex-col space-y-1 p-4">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `${linkClass} ${isActive ? activeClass : 'text-zinc-700 dark:text-zinc-300'}`
              }
              onClick={() => setOpen(false)}
            >
              Home
            </NavLink>
            <NavLink
              to="/about"
              className={({ isActive }) =>
                `${linkClass} ${isActive ? activeClass : 'text-zinc-700 dark:text-zinc-300'}`
              }
              onClick={() => setOpen(false)}
            >
              About
            </NavLink>
            <NavLink
              to="/how-it-works"
              className={({ isActive }) =>
                `${linkClass} ${isActive ? activeClass : 'text-zinc-700 dark:text-zinc-300'}`
              }
              onClick={() => setOpen(false)}
            >
              How It Works
            </NavLink>
            <NavLink
              to="/pricing"
              className={({ isActive }) =>
                `${linkClass} ${isActive ? activeClass : 'text-zinc-700 dark:text-zinc-300'}`
              }
              onClick={() => setOpen(false)}
            >
              Pricing
            </NavLink>
            <a
              href="https://docs.dsentr.com"
              target="_blank"
              rel="noopener noreferrer"
              title="Documentation"
              className={`${linkClass} text-zinc-700 dark:text-zinc-300`}
              onClick={() => setOpen(false)}
            >
              Documentation
            </a>
          </nav>
        </div>
      )}
    </div>
  )
}

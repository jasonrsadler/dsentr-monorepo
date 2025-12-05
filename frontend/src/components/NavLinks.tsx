import { NavLink } from 'react-router-dom'

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200',
    isActive
      ? 'font-semibold bg-indigo-50 text-indigo-600 text-primary ring-1 ring-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-100 dark:ring-indigo-800/60'
      : 'text-zinc-700 hover:bg-indigo-50 hover:text-indigo-600 dark:text-zinc-200 dark:hover:bg-indigo-900/30 dark:hover:text-white'
  ].join(' ')

export function NavLinks() {
  return (
    <nav className="flex items-center gap-6">
      <NavLink
        to="/"
        className={({ isActive }) => navLinkClasses({ isActive })}
      >
        Home
      </NavLink>
      <NavLink
        to="/about"
        className={({ isActive }) => navLinkClasses({ isActive })}
      >
        About
      </NavLink>
      <NavLink
        to="/how-it-works"
        className={({ isActive }) => navLinkClasses({ isActive })}
      >
        How it works
      </NavLink>
      <NavLink
        to="/pricing"
        className={({ isActive }) => navLinkClasses({ isActive })}
      >
        Pricing
      </NavLink>
      <a
        href="https://docs.dsentr.com"
        target="_blank"
        rel="noopener noreferrer"
        title="Documentation"
        className={navLinkClasses({ isActive: false })}
      >
        Documentation
      </a>
    </nav>
  )
}

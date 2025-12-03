import { NavLink } from 'react-router-dom'

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    'transition-colors',
    'text-sm font-medium',
    'hover:text-zinc-900 dark:hover:text-white',
    isActive ? 'text-black dark:text-white' : 'text-zinc-700 dark:text-zinc-300'
  ].join(' ')

export function NavLinks() {
  return (
    <nav className="flex items-center gap-6">
      <NavLink
        to="/"
        className={({ isActive }) =>
          `${navLinkClasses({ isActive })} ${isActive ? 'font-semibold text-primary' : 'text-white'} hover:text-primary transition-all ease-in-out duration-300`
        }
      >
        Home
      </NavLink>
      <NavLink
        to="/about"
        className={({ isActive }) =>
          `${navLinkClasses({ isActive })} ${isActive ? 'font-semibold text-primary' : 'text-white'} hover:text-primary transition-all ease-in-out duration-300`
        }
      >
        About
      </NavLink>
      <NavLink
        to="/how-it-works"
        className={({ isActive }) =>
          `${navLinkClasses({ isActive })} ${isActive ? 'font-semibold text-primary' : 'text-white'} hover:text-primary transition-all ease-in-out duration-300`
        }
      >
        How it works
      </NavLink>
      <a
        href="https://docs.dsentr.com"
        target="_blank"
        rel="noopener noreferrer"
        title="Documentation"
        className={`${navLinkClasses({ isActive: true })} font-semibold text-primary hover:text-primary transition-all ease-in-out duration-300`}
      >
        Documentation
      </a>
    </nav>
  )
}

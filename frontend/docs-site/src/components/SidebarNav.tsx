import { NavLink, useLocation } from 'react-router-dom'
import { navItems } from '../content/navigation'

export function SidebarNav() {
  const location = useLocation()

  return (
    <aside className="sidebar" aria-label="Documentation navigation">
      <h2>Explore the docs</h2>
      <nav>
        <ul className="nav-list">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  [
                    'nav-link',
                    isActive || (item.to === '/' && location.pathname === '/')
                      ? 'active'
                      : ''
                  ]
                    .join(' ')
                    .trim()
                }
                aria-label={`${item.label} — ${item.description}`}
                end={item.to === '/'}
              >
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/users', label: 'Users' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/issues', label: 'Issues' },
];

export default function Sidebar() {
  return (
    <aside className="flex h-full min-h-screen w-60 flex-col border-r border-slate-800 bg-slate-950/80 px-4 py-6">
      <div className="mb-6 text-xl font-bold text-slate-100">Dsentr Admin</div>
      <nav className="flex flex-1 flex-col gap-1 text-sm font-semibold">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `rounded-lg px-3 py-2 transition hover:bg-slate-800 ${
                isActive ? 'bg-slate-800 text-accent' : 'text-slate-200'
              }`
            }
            end={link.to === '/'}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6 text-xs text-slate-500">
        Read-only admin tools. Replies to issues are the only mutable action here.
      </div>
    </aside>
  );
}

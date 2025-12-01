import { ReactNode } from 'react';
import { useAuthStore } from '../../stores/authStore';

interface HeaderProps {
  title?: string;
  actions?: ReactNode;
}

export default function Header({ title, actions }: HeaderProps) {
  const { user, logout } = useAuthStore();

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-6 py-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-accent">Admin Portal</div>
        <h1 className="text-xl font-bold text-slate-100">{title ?? 'Control room'}</h1>
      </div>
      <div className="flex items-center gap-3">
        {actions}
        {user && (
          <div className="flex items-center gap-3 rounded-full border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
            <div className="text-right">
              <div className="font-semibold text-slate-100">{user.email}</div>
              <div className="text-xs text-slate-500">
                {user.role === 'admin' ? 'Admin' : 'User'} | {user.plan ?? 'solo'}
              </div>
            </div>
            <button className="btn-ghost text-xs" onClick={logout}>
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

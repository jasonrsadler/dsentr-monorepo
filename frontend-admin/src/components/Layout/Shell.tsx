import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';

const titleMap: Record<string, string> = {
  '/': 'Dashboard',
  '/users': 'Users',
  '/workspaces': 'Workspaces',
  '/workflows': 'Workflows',
  '/issues': 'Issues',
};

export default function Shell() {
  const location = useLocation();
  const basePath = '/' + location.pathname.split('/')[1];
  const title = titleMap[basePath] ?? 'Admin';

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header title={title} />
        <main className="flex-1 space-y-6 bg-slate-950 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

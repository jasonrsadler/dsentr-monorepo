import { ReactNode, useEffect } from "react";
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
} from "react-router-dom";
import Shell from "./components/Layout/Shell";
import DashboardPage from "./pages/Dashboard/DashboardPage";
import IssueDetail from "./pages/Issues/IssueDetail";
import IssuesList from "./pages/Issues/IssuesList";
import LoginPage from "./pages/Login/LoginPage";
import UserDetail from "./pages/Users/UserDetail";
import UsersList from "./pages/Users/UsersList";
import WorkspaceDetail from "./pages/Workspaces/WorkspaceDetail";
import WorkspacesList from "./pages/Workspaces/WorkspacesList";
import WorkflowDetail from "./pages/Workflows/WorkflowDetail";
import WorkflowsList from "./pages/Workflows/WorkflowsList";
import { useAuthStore } from "./stores/authStore";

function RequireAdmin({ children }: { children?: ReactNode }) {
  const { user, loading, error, bootstrap } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (!user && !loading) {
      bootstrap();
    }
  }, [bootstrap, loading, user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="animate-pulse text-sm text-slate-400">
          Checking session...
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (user.role?.toLowerCase() !== "admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-100">
        <div className="card max-w-md text-center text-sm">
          <div className="mb-2 text-lg font-semibold text-red-300">
            Not an admin
          </div>
          <p className="text-slate-400">
            {error ??
              "Your account is signed in but does not have admin access."}
          </p>
          <a href="/login" className="mt-3 inline-flex text-accent">
            Switch account
          </a>
        </div>
      </div>
    );
  }

  if (children) {
    return <>{children}</>;
  }

  return <Outlet />;
}

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAdmin>
        <Shell />
      </RequireAdmin>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "users", element: <UsersList /> },
      { path: "users/:id", element: <UserDetail /> },
      { path: "workspaces", element: <WorkspacesList /> },
      { path: "workspaces/:id", element: <WorkspaceDetail /> },
      { path: "workflows", element: <WorkflowsList /> },
      { path: "workflows/:id", element: <WorkflowDetail /> },
      { path: "issues", element: <IssuesList /> },
      { path: "issues/:id", element: <IssueDetail /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}

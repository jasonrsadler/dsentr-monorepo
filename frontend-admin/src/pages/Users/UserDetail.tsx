import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getUser,
  getUserConnections,
  getUserWorkspaces,
} from "../../api/users";
import {
  AdminUserDetail,
  ConnectionSummary,
  WorkspaceMembershipSummary,
} from "../../api/types";
import JsonView from "../../components/JsonView";
import Table from "../../components/Table";

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembershipSummary[]>(
    [],
  );
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const [userRes, workspacesRes, connectionsRes] = await Promise.all([
          getUser(id ?? ""),
          getUserWorkspaces(id ?? ""),
          getUserConnections(id ?? ""),
        ]);
        setUser(userRes);
        setWorkspaces(workspacesRes);
        setConnections(connectionsRes);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load user");
      }
    }
    load();
  }, [id]);

  if (!id) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            User
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            {user?.email ?? id}
          </h2>
          <div className="text-xs text-slate-500">
            {user?.role ?? "unknown"} | Plan: {user?.plan ?? "none"} |{" "}
            {user?.is_verified ? "Verified" : "Unverified"}
          </div>
        </div>
        <span className="pill">{user?.company_name ?? "No company"}</span>
      </div>

      {error && <div className="card text-sm text-red-200">{error}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-2 text-sm font-semibold text-slate-200">
            Workspaces
          </div>
          <Table
            data={workspaces}
            columns={[
              {
                key: "workspace",
                header: "Workspace",
                render: (row) => (
                  <Link
                    className="text-accent"
                    to={`/workspaces/${row.workspace.id}`}
                  >
                    {row.workspace.name}
                  </Link>
                ),
              },
              { key: "role", header: "Role" },
              {
                key: "plan",
                header: "Plan",
                render: (row) => row.workspace.plan,
              },
            ]}
            empty="No workspaces"
          />
        </div>
        <div className="card">
          <div className="mb-2 text-sm font-semibold text-slate-200">
            OAuth connections
          </div>
          <Table
            data={connections}
            columns={[
              { key: "provider", header: "Provider" },
              { key: "account_email", header: "Account" },
              { key: "scope", header: "Scope" },
              {
                key: "workspace_id",
                header: "Workspace",
                render: (row) => row.workspace_id ?? "Personal",
              },
              {
                key: "updated_at",
                header: "Updated",
                render: (row) => new Date(row.updated_at).toLocaleString(),
              },
            ]}
            empty="No connections"
          />
        </div>
      </div>

      <JsonView value={user?.settings ?? {}} />
    </div>
  );
}

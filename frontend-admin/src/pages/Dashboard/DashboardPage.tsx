import { useEffect, useState } from "react";
import ChartView from "../../components/ChartView";
import Table from "../../components/Table";
import { listIssues } from "../../api/issues";
import { listUsers } from "../../api/users";
import { listWorkflows } from "../../api/workflows";
import { listWorkspaces } from "../../api/workspaces";
import {
  IssueSummary,
  WorkspaceSummary,
  WorkflowSummary,
  AdminUser,
} from "../../api/types";

interface StatBlock {
  label: string;
  value: number;
  helper?: string;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [stats, setStats] = useState<StatBlock[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [usersRes, workspaceRes, workflowRes, issuesRes] =
          await Promise.all([
            listUsers({ limit: 5, sort_by: "updated_at" }),
            listWorkspaces({ limit: 5, sort_by: "updated_at" }),
            listWorkflows({ limit: 5, sort_by: "updated_at" }),
            listIssues({ limit: 5, sort_by: "updated_at" }),
          ]);

        setStats([
          { label: "Users", value: usersRes.total },
          { label: "Workspaces", value: workspaceRes.total },
          { label: "Workflows", value: workflowRes.total },
          {
            label: "Issues",
            value: issuesRes.total,
            helper: "Read-only monitoring",
          },
        ]);
        setIssues(issuesRes.data);
        setWorkspaces(workspaceRes.data);
        setWorkflows(workflowRes.data);
        setUsers(usersRes.data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load dashboard",
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const workspaceChart = workspaces.map((ws) => ({
    label: ws.name.slice(0, 8),
    value: ws.run_count,
  }));

  const issueChart = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.status] = (acc[issue.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              {stat.label}
            </div>
            <div className="text-2xl font-bold text-slate-100">
              {stat.value}
            </div>
            {stat.helper && (
              <div className="text-xs text-slate-500">{stat.helper}</div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="card text-sm text-red-200">Error: {error}</div>}
      {loading && (
        <div className="card text-sm text-slate-400">Loading dashboards...</div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartView
            title="Workspace run counts (current page)"
            data={workspaceChart}
            type="bar"
          />
          <ChartView
            title="Issues by status"
            data={Object.entries(issueChart).map(([label, value]) => ({
              label,
              value,
            }))}
            type="bar"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-200">
            Recent workspaces
            <a href="/workspaces" className="text-xs text-accent">
              View all
            </a>
          </div>
          <Table
            data={workspaces}
            columns={[
              { key: "name", header: "Name" },
              { key: "plan", header: "Plan" },
              { key: "member_count", header: "Members" },
              { key: "run_count", header: "Runs" },
            ]}
          />
        </div>
        <div className="card">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-200">
            Latest issues
            <a href="/issues" className="text-xs text-accent">
              View all
            </a>
          </div>
          <Table
            data={issues}
            columns={[
              {
                key: "id",
                header: "ID",
                render: (row) => (row as IssueSummary).id.slice(0, 8),
              },
              { key: "user_email", header: "User" },
              { key: "status", header: "Status" },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-200">
            Active workflows
            <a href="/workflows" className="text-xs text-accent">
              View all
            </a>
          </div>
          <Table
            data={workflows}
            columns={[
              { key: "name", header: "Name" },
              { key: "workspace_id", header: "Workspace" },
              { key: "run_count", header: "Runs" },
            ]}
          />
        </div>
        <div className="card">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-200">
            New users
            <a href="/users" className="text-xs text-accent">
              View all
            </a>
          </div>
          <Table
            data={users}
            columns={[
              { key: "email", header: "Email" },
              { key: "plan", header: "Plan" },
              {
                key: "created_at",
                header: "Created",
                render: (row) => new Date(row.created_at).toLocaleDateString(),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

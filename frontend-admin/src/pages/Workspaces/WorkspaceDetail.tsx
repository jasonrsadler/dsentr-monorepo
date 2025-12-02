import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getWorkspace, getWorkspaceMembers } from "../../api/workspaces";
import {
  IssueSummary,
  WorkspaceDetailResponse,
  WorkspaceMember,
  WorkflowSummary,
} from "../../api/types";
import Table from "../../components/Table";

export default function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();
  const [workspace, setWorkspace] = useState<WorkspaceDetailResponse | null>(
    null,
  );
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const [workspaceRes, membersRes] = await Promise.all([
          getWorkspace(id ?? ""),
          getWorkspaceMembers(id ?? ""),
        ]);
        setWorkspace(workspaceRes);
        setMembers(membersRes);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load workspace",
        );
      }
    }
    load();
  }, [id]);

  if (!id) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Workspace
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            {workspace?.workspace.name ?? id}
          </h2>
          <div className="text-xs text-slate-500">
            Plan: {workspace?.workspace.plan} | Owner:{" "}
            {workspace?.workspace.owner_id}
          </div>
        </div>
        <div className="pill">
          Member limit {workspace?.quotas.member_limit} | Run limit{" "}
          {workspace?.quotas.run_limit}
        </div>
      </div>

      {error && <div className="card text-sm text-red-200">{error}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-2 text-sm font-semibold text-slate-200">
            Members
          </div>
          <Table
            data={members}
            columns={[
              { key: "email", header: "Email" },
              { key: "role", header: "Role" },
              {
                key: "joined_at",
                header: "Joined",
                render: (row) => new Date(row.joined_at).toLocaleDateString(),
              },
            ]}
            empty="No members"
          />
        </div>
        <div className="card">
          <div className="mb-2 text-sm font-semibold text-slate-200">
            Invites
          </div>
          <Table
            data={workspace?.invites ?? []}
            columns={[
              { key: "email", header: "Email" },
              { key: "role", header: "Role" },
              { key: "status", header: "Status" },
              {
                key: "expires_at",
                header: "Expires",
                render: (row) => new Date(row.expires_at).toLocaleDateString(),
              },
            ]}
            empty="No invites"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-2 text-sm font-semibold text-slate-200">
            Connections
          </div>
          <Table
            data={workspace?.connections ?? []}
            columns={[
              { key: "provider", header: "Provider" },
              { key: "account_email", header: "Account" },
              { key: "shared_by_email", header: "Shared by" },
              {
                key: "updated_at",
                header: "Updated",
                render: (row) => new Date(row.updated_at).toLocaleString(),
              },
            ]}
            empty="No shared connections"
          />
        </div>
        <div className="card">
          <div className="mb-2 text-sm font-semibold text-slate-200">
            Workflows
          </div>
          <Table
            data={(workspace?.workflows ?? []) as WorkflowSummary[]}
            columns={[
              { key: "id", header: "ID", render: (row) => row.id.slice(0, 8) },
              { key: "name", header: "Name" },
              {
                key: "updated_at",
                header: "Updated",
                render: (row) => new Date(row.updated_at).toLocaleDateString(),
              },
            ]}
            empty="No workflows"
          />
        </div>
      </div>

      <div className="card">
        <div className="mb-2 text-sm font-semibold text-slate-200">Issues</div>
        <Table
          data={(workspace?.issues ?? []) as IssueSummary[]}
          columns={[
            { key: "id", header: "ID", render: (row) => row.id.slice(0, 8) },
            { key: "status", header: "Status" },
            {
              key: "unread_user_messages",
              header: "Unread",
              render: (row) =>
                row.unread_user_messages > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">
                    <span className="h-2 w-2 rounded-full bg-amber-300" />
                    {row.unread_user_messages}
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">0</span>
                ),
            },
            {
              key: "created_at",
              header: "Created",
              render: (row) => new Date(row.created_at).toLocaleString(),
            },
          ]}
          empty="No issues"
        />
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ChartView from "../../components/ChartView";
import Pagination from "../../components/Pagination";
import SearchBox from "../../components/SearchBox";
import Table from "../../components/Table";
import { listWorkspaces } from "../../api/workspaces";
import { WorkspaceSummary } from "../../api/types";

export default function WorkspacesList() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function load() {
      try {
        const res = await listWorkspaces({
          page,
          limit,
          search: search.trim() || undefined,
          sort_by: "created_at",
        });
        setWorkspaces(res.data);
        setTotal(res.total);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load workspaces",
        );
      }
    }
    load();
  }, [page, limit, search]);

  const chartData = useMemo(
    () =>
      workspaces.map((ws) => ({
        label: ws.name.slice(0, 8),
        value: ws.run_count,
      })),
    [workspaces],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Workspaces
          </div>
          <h2 className="text-xl font-bold text-slate-100">Organizations</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`btn-ghost text-xs ${view === "table" ? "border-accent text-accent" : ""}`}
            onClick={() => setView("table")}
          >
            Table
          </button>
          <button
            className={`btn-ghost text-xs ${view === "chart" ? "border-accent text-accent" : ""}`}
            onClick={() => setView("chart")}
          >
            Chart
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox
          placeholder="Search by name or owner email"
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          defaultValue={search}
        />
        <div className="text-xs text-slate-500">Sorted by created_at</div>
      </div>

      {error && <div className="card text-sm text-red-200">{error}</div>}

      {view === "chart" ? (
        <ChartView
          title="Runs per workspace (current page)"
          data={chartData}
          type="bar"
        />
      ) : (
        <>
          <Table
            data={workspaces}
            columns={[
              {
                key: "id",
                header: "ID",
                render: (row) => (row as WorkspaceSummary).id.slice(0, 8),
              },
              {
                key: "name",
                header: "Name",
                render: (row) => (
                  <Link
                    className="text-accent"
                    to={`/workspaces/${(row as WorkspaceSummary).id}`}
                  >
                    {(row as WorkspaceSummary).name}
                  </Link>
                ),
              },
              { key: "owner_email", header: "Owner" },
              { key: "plan", header: "Plan" },
              { key: "member_count", header: "Members" },
              { key: "run_count", header: "Runs" },
              {
                key: "created_at",
                header: "Created",
                render: (row) =>
                  new Date(
                    (row as WorkspaceSummary).created_at,
                  ).toLocaleDateString(),
              },
            ]}
            empty="No workspaces found"
          />
          <Pagination
            page={page}
            limit={limit}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

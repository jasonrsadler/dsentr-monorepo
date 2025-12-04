import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ChartView from "../../components/ChartView";
import Pagination from "../../components/Pagination";
import SearchBox from "../../components/SearchBox";
import Table from "../../components/Table";
import { listWorkspaces } from "../../api/workspaces";
import { WorkspaceSummary } from "../../api/types";
import { fetchAllPages } from "../../api/fetchAllPages";

export default function WorkspacesList() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setError(undefined);
        const allWorkspaces = await fetchAllPages((pageNum, pageSize) =>
          listWorkspaces({
            page: pageNum,
            limit: pageSize,
            sort_by: "created_at",
          }),
        );
        if (!cancelled) {
          setWorkspaces(allWorkspaces);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load workspaces",
          );
        }
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredWorkspaces = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return workspaces;
    return workspaces.filter((ws) => {
      const ownerEmail = ws.owner_email ?? "";
      return (
        ws.name.toLowerCase().includes(term) ||
        ownerEmail.toLowerCase().includes(term) ||
        ws.plan.toLowerCase().includes(term) ||
        ws.id.toLowerCase().includes(term)
      );
    });
  }, [search, workspaces]);

  const totalPages = Math.max(1, Math.ceil(filteredWorkspaces.length / limit));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const currentPage = Math.min(page, totalPages);

  const paginatedWorkspaces = useMemo(() => {
    const start = (currentPage - 1) * limit;
    return filteredWorkspaces.slice(start, start + limit);
  }, [currentPage, filteredWorkspaces, limit]);

  const chartData = useMemo(
    () =>
      paginatedWorkspaces.map((ws) => ({
        label: ws.name.slice(0, 8),
        value: ws.run_count,
      })),
    [paginatedWorkspaces],
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
            data={paginatedWorkspaces}
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
            page={currentPage}
            limit={limit}
            total={filteredWorkspaces.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ChartView from "../../components/ChartView";
import Pagination from "../../components/Pagination";
import SearchBox from "../../components/SearchBox";
import Table from "../../components/Table";
import { listIssues } from "../../api/issues";
import { IssueSummary } from "../../api/types";

export default function IssuesList() {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function load() {
      try {
        const res = await listIssues({
          page,
          limit,
          search: search.trim() || undefined,
          sort_by: "updated_at",
        });
        setIssues(res.data);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load issues");
      }
    }
    load();
  }, [page, limit, search]);

  const chartData = useMemo(() => {
    const statusCounts = issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.status] = (acc[issue.status] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(statusCounts).map(([label, value]) => ({
      label,
      value,
    }));
  }, [issues]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Issues
          </div>
          <h2 className="text-xl font-bold text-slate-100">Support threads</h2>
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
          placeholder="Search by email or status"
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          defaultValue={search}
        />
        <div className="text-xs text-slate-500">Sorted by updated_at</div>
      </div>

      {error && <div className="card text-sm text-red-200">{error}</div>}

      {view === "chart" ? (
        <ChartView title="Issues by status" data={chartData} type="bar" />
      ) : (
        <>
          <Table
            data={issues}
            rowClassName={(row: IssueSummary) =>
              row.unread_user_messages > 0
                ? "bg-slate-800/40 font-semibold"
                : ""
            }
            columns={[
              {
                key: "id",
                header: "ID",
                render: (row) => (row as IssueSummary).id.slice(0, 8),
              },
              { key: "user_email", header: "User" },
              {
                key: "workspace_id",
                header: "Workspace",
                render: (row) => (row as IssueSummary).workspace_id ?? "-",
              },
              { key: "status", header: "Status" },
              {
                key: "unread_user_messages",
                header: "Unread",
                render: (row) => {
                  const unread = (row as IssueSummary).unread_user_messages;
                  return unread > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">
                      <span className="h-2 w-2 rounded-full bg-amber-300" />
                      {unread}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">0</span>
                  );
                },
              },
              {
                key: "created_at",
                header: "Created",
                render: (row) =>
                  new Date((row as IssueSummary).created_at).toLocaleString(),
              },
              {
                key: "view",
                header: "",
                render: (row) => (
                  <Link
                    className="text-accent"
                    to={`/issues/${(row as IssueSummary).id}`}
                  >
                    View
                  </Link>
                ),
              },
            ]}
            empty="No issues"
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

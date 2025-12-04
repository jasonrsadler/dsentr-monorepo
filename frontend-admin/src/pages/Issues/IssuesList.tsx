import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ChartView from "../../components/ChartView";
import Pagination from "../../components/Pagination";
import SearchBox from "../../components/SearchBox";
import Table from "../../components/Table";
import { listIssues } from "../../api/issues";
import { IssueSummary } from "../../api/types";
import { fetchAllPages } from "../../api/fetchAllPages";

export default function IssuesList() {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
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
        const allIssues = await fetchAllPages((pageNum, pageSize) =>
          listIssues({
            page: pageNum,
            limit: pageSize,
            sort_by: "updated_at",
          }),
        );
        if (!cancelled) {
          setIssues(allIssues);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load issues",
          );
        }
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredIssues = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return issues;
    return issues.filter((issue) => {
      const workspaceId = issue.workspace_id ?? "";
      return (
        issue.user_email.toLowerCase().includes(term) ||
        issue.status.toLowerCase().includes(term) ||
        workspaceId.toLowerCase().includes(term) ||
        issue.id.toLowerCase().includes(term)
      );
    });
  }, [issues, search]);

  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / limit));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const currentPage = Math.min(page, totalPages);

  const paginatedIssues = useMemo(() => {
    const start = (currentPage - 1) * limit;
    return filteredIssues.slice(start, start + limit);
  }, [currentPage, filteredIssues, limit]);

  const chartData = useMemo(() => {
    const statusCounts = paginatedIssues.reduce<Record<string, number>>(
      (acc, issue) => {
        acc[issue.status] = (acc[issue.status] ?? 0) + 1;
        return acc;
      },
      {},
    );
    return Object.entries(statusCounts).map(([label, value]) => ({
      label,
      value,
    }));
  }, [paginatedIssues]);

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
            data={paginatedIssues}
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
            page={currentPage}
            limit={limit}
            total={filteredIssues.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

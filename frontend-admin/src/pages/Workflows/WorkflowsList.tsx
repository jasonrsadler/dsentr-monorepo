import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ChartView from "../../components/ChartView";
import Pagination from "../../components/Pagination";
import SearchBox from "../../components/SearchBox";
import Table from "../../components/Table";
import { listWorkflows } from "../../api/workflows";
import { WorkflowSummary } from "../../api/types";
import { fetchAllPages } from "../../api/fetchAllPages";

export default function WorkflowsList() {
  const [allWorkflows, setAllWorkflows] = useState<WorkflowSummary[]>([]);
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
        const fetchedWorkflows = await fetchAllPages((pageNum, pageSize) =>
          listWorkflows({
            page: pageNum,
            limit: pageSize,
            sort_by: "updated_at",
          }),
        );

        if (!cancelled) {
          setAllWorkflows(fetchedWorkflows);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load workflows",
          );
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredWorkflows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allWorkflows;
    return allWorkflows.filter((wf) => {
      const workspace = wf.workspace_id ?? "";
      return (
        wf.name.toLowerCase().includes(term) ||
        workspace.toLowerCase().includes(term) ||
        wf.id.toLowerCase().includes(term)
      );
    });
  }, [allWorkflows, search]);

  const totalPages = Math.max(1, Math.ceil(filteredWorkflows.length / limit));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const currentPage = Math.min(page, totalPages);

  const paginatedWorkflows = useMemo(() => {
    const start = (currentPage - 1) * limit;
    return filteredWorkflows.slice(start, start + limit);
  }, [currentPage, filteredWorkflows, limit]);

  const chartData = useMemo(
    () =>
      paginatedWorkflows.map((wf) => ({
        label: wf.name.slice(0, 8),
        value: wf.run_count,
      })),
    [paginatedWorkflows],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Workflows
          </div>
          <h2 className="text-xl font-bold text-slate-100">Automations</h2>
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
          placeholder="Search workflows"
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
        <ChartView title="Workflow run counts" data={chartData} type="bar" />
      ) : (
        <>
          <Table
            data={paginatedWorkflows}
            columns={[
              {
                key: "id",
                header: "ID",
                render: (row) => (row as WorkflowSummary).id.slice(0, 8),
              },
              {
                key: "name",
                header: "Name",
                render: (row) => (
                  <Link
                    className="text-accent"
                    to={`/workflows/${(row as WorkflowSummary).id}`}
                  >
                    {(row as WorkflowSummary).name}
                  </Link>
                ),
              },
              {
                key: "workspace_id",
                header: "Workspace",
                render: (row) =>
                  (row as WorkflowSummary).workspace_id ?? "Personal",
              },
              { key: "run_count", header: "Runs" },
              {
                key: "updated_at",
                header: "Updated",
                render: (row) =>
                  new Date(
                    (row as WorkflowSummary).updated_at,
                  ).toLocaleString(),
              },
            ]}
            empty="No workflows"
          />
          <Pagination
            page={currentPage}
            limit={limit}
            total={filteredWorkflows.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

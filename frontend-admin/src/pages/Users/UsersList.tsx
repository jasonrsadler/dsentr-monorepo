import { useEffect, useMemo, useState } from "react";
import ChartView from "../../components/ChartView";
import Pagination from "../../components/Pagination";
import SearchBox from "../../components/SearchBox";
import Table from "../../components/Table";
import { listUsers } from "../../api/users";
import { AdminUser } from "../../api/types";
import { Link } from "react-router-dom";

export default function UsersList() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function load() {
      try {
        const res = await listUsers({
          page,
          limit,
          search: search.trim() || undefined,
          sort_by: "created_at",
        });
        setUsers(res.data);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load users");
      }
    }
    load();
  }, [page, limit, search]);

  const chartData = useMemo(() => {
    const planCounts = users.reduce<Record<string, number>>((acc, user) => {
      const key = user.plan ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(planCounts).map(([label, value]) => ({
      label,
      value,
    }));
  }, [users]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Users
          </div>
          <h2 className="text-xl font-bold text-slate-100">Directory</h2>
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
          placeholder="Search by email"
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
          title="Users by plan (current page)"
          data={chartData}
          type="bar"
        />
      ) : (
        <>
          <Table
            data={users}
            columns={[
              {
                key: "id",
                header: "ID",
                render: (row) => (row as AdminUser).id.slice(0, 8),
              },
              {
                key: "email",
                header: "Email",
                render: (row) => (
                  <Link
                    className="text-accent"
                    to={`/users/${(row as AdminUser).id}`}
                  >
                    {(row as AdminUser).email}
                  </Link>
                ),
              },
              { key: "plan", header: "Plan" },
              {
                key: "created_at",
                header: "Created",
                render: (row) =>
                  new Date((row as AdminUser).created_at).toLocaleDateString(),
              },
              {
                key: "is_verified",
                header: "Verified",
                render: (row) => (
                  <span className="pill">
                    {(row as AdminUser).is_verified ? "Yes" : "No"}
                  </span>
                ),
              },
              {
                key: "is_admin",
                header: "Admin",
                render: (row) => (
                  <span className="pill">
                    {(row as AdminUser).is_admin ? "Admin" : "User"}
                  </span>
                ),
              },
            ]}
            empty="No users found"
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

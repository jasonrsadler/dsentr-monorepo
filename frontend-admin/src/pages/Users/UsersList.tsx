import { useEffect, useMemo, useState } from "react";
import ChartView from "../../components/ChartView";
import Pagination from "../../components/Pagination";
import SearchBox from "../../components/SearchBox";
import Table from "../../components/Table";
import { listUsers } from "../../api/users";
import { AdminUser } from "../../api/types";
import { Link } from "react-router-dom";
import { fetchAllPages } from "../../api/fetchAllPages";

export default function UsersList() {
  const [users, setUsers] = useState<AdminUser[]>([]);
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
        const allUsers = await fetchAllPages((pageNum, pageSize) =>
          listUsers({
            page: pageNum,
            limit: pageSize,
            sort_by: "created_at",
          }),
        );

        if (!cancelled) {
          setUsers(allUsers);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load users");
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => {
      const fullName = `${user.first_name} ${user.last_name}`.toLowerCase();
      const plan = user.plan ?? "";
      return (
        user.email.toLowerCase().includes(term) ||
        fullName.includes(term) ||
        plan.toLowerCase().includes(term)
      );
    });
  }, [search, users]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / limit));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const currentPage = Math.min(page, totalPages);

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * limit;
    return filteredUsers.slice(start, start + limit);
  }, [currentPage, filteredUsers, limit]);

  const chartData = useMemo(() => {
    const planCounts = paginatedUsers.reduce<Record<string, number>>(
      (acc, user) => {
        const key = user.plan ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );
    return Object.entries(planCounts).map(([label, value]) => ({
      label,
      value,
    }));
  }, [paginatedUsers]);

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
          placeholder="Search by email or name"
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
            data={paginatedUsers}
            columns={[
              {
                key: "id",
                header: "ID",
                render: (row) => (row as AdminUser).id.slice(0, 8),
              },
              { key: "first_name", header: "First" },
              { key: "last_name", header: "Last" },
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
            page={currentPage}
            limit={limit}
            total={filteredUsers.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

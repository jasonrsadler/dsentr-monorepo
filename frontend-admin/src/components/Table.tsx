import React from "react";

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render?: (row: T) => React.ReactNode;
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  empty?: string;
  rowKey?: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string;
}

export function Table<T>({
  data,
  columns,
  empty = "No results",
  rowKey,
  rowClassName,
}: TableProps<T>) {
  if (!data.length) {
    return <div className="card text-sm text-slate-400">{empty}</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 shadow-xl">
      <table className="min-w-full divide-y divide-slate-800 bg-slate-900/80">
        <thead className="bg-slate-900/60 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-semibold ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 text-sm">
          {data.map((row, idx) => (
            <tr
              key={rowKey ? rowKey(row, idx) : idx.toString()}
              className={`hover:bg-slate-800/60 transition-colors ${rowClassName ? rowClassName(row, idx) : ""}`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-3 align-top ${col.className ?? ""}`}
                >
                  {col.render
                    ? col.render(row)
                    : (row as Record<string, React.ReactNode>)[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Table;

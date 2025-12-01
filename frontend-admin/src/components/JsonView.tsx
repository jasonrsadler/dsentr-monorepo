import { useState } from "react";

interface JsonViewProps {
  value: unknown;
  collapsed?: boolean;
}

export default function JsonView({ value, collapsed = false }: JsonViewProps) {
  const [open, setOpen] = useState(!collapsed);
  const pretty = JSON.stringify(value, null, 2);

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-200">JSON</div>
        <button
          className="btn-ghost text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      {open ? (
        <pre className="overflow-auto rounded-lg bg-slate-950/80 p-3 text-xs text-slate-100">
          {pretty}
        </pre>
      ) : (
        <div className="text-xs text-slate-400">Collapsed</div>
      )}
    </div>
  );
}

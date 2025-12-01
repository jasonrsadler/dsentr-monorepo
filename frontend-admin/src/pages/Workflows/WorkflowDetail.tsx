import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getWorkflow, getWorkflowJson } from "../../api/workflows";
import {
  RunSummary,
  WorkflowDetail as WorkflowDetailType,
} from "../../api/types";
import ChartView from "../../components/ChartView";
import JsonView from "../../components/JsonView";
import Table from "../../components/Table";

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<WorkflowDetailType | null>(null);
  const [json, setJson] = useState<unknown>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const [wfRes, jsonRes] = await Promise.all([
          getWorkflow(id ?? ""),
          getWorkflowJson(id ?? ""),
        ]);
        setWorkflow(wfRes);
        setJson(jsonRes);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load workflow",
        );
      }
    }
    load();
  }, [id]);

  const runChart = useMemo(() => {
    const runs = workflow?.runs ?? [];
    return runs.map((run: RunSummary, idx: number) => ({
      label: `#${runs.length - idx}`,
      value: run.status === "failed" ? 0 : 1,
    }));
  }, [workflow]);

  if (!id) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Workflow
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            {workflow?.name ?? id}
          </h2>
          <div className="text-xs text-slate-500">
            Workspace: {workflow?.workspace_id ?? "Personal"} | Runs:{" "}
            {workflow?.run_count ?? 0}
          </div>
        </div>
        <div className="pill">
          Updated{" "}
          {workflow ? new Date(workflow.updated_at).toLocaleString() : "-"}
        </div>
      </div>

      {error && <div className="card text-sm text-red-200">{error}</div>}

      <ChartView title="Recent run health" data={runChart} type="line" />

      <div className="card">
        <div className="mb-2 text-sm font-semibold text-slate-200">
          Recent runs
        </div>
        <Table
          data={workflow?.runs ?? []}
          columns={[
            { key: "id", header: "ID", render: (row) => row.id.slice(0, 8) },
            { key: "status", header: "Status" },
            {
              key: "created_at",
              header: "Created",
              render: (row) => new Date(row.created_at).toLocaleString(),
            },
          ]}
          empty="No runs"
        />
      </div>

      <JsonView value={json ?? {}} />
    </div>
  );
}

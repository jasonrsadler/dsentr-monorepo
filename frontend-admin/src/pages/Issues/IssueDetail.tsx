import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getIssue, replyToIssue } from "../../api/issues";
import { IssueDetail as IssueDetailType, IssueMessage } from "../../api/types";
import JsonView from "../../components/JsonView";

export default function IssueDetail() {
  const { id } = useParams<{ id: string }>();
  const [issue, setIssue] = useState<IssueDetailType | null>(null);
  const [messages, setMessages] = useState<IssueMessage[]>([]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const res = await getIssue(id ?? "");
        setIssue(res);
        setMessages(Array.isArray(res.messages) ? res.messages : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load issue");
      }
    }
    load();
  }, [id]);

  async function onReply(e: FormEvent) {
    e.preventDefault();
    if (!id || !reply.trim()) return;
    setSending(true);
    try {
      const res = await replyToIssue(id, reply);
      setMessages(Array.isArray(res) ? res : []);
      setReply("");
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  if (!id) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Issue
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            {issue?.issue.id ?? id}
          </h2>
          <div className="text-xs text-slate-500">
            User: {issue?.issue.user_email} | Status: {issue?.issue.status}
          </div>
        </div>
        <div className="pill">
          Workspace {issue?.issue.workspace_id ?? "N/A"}
        </div>
      </div>

      {error && <div className="card text-sm text-red-200">{error}</div>}

      <div className="card space-y-3">
        <div className="text-sm font-semibold text-slate-200">Thread</div>
        <div className="space-y-2">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-lg border px-3 py-2 text-sm ${
                msg.sender_type === "admin"
                  ? "border-sky-600/40 bg-sky-900/30"
                  : "border-slate-700 bg-slate-900/60"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="uppercase tracking-wide">
                  {msg.sender_type}
                </span>
                <span>{new Date(msg.created_at).toLocaleString()}</span>
              </div>
              <div className="text-slate-100">{msg.body}</div>
            </div>
          ))}
        </div>

        <form onSubmit={onReply} className="space-y-2">
          <label className="block text-sm font-semibold text-slate-200">
            Reply (admins only)
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
          </label>
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Replies are visible to the user; main app will expose a user reply
              form later.
            </div>
            <button
              className="btn"
              type="submit"
              disabled={sending || !reply.trim()}
            >
              {sending ? "Sending..." : "Send reply"}
            </button>
          </div>
        </form>
      </div>

      <JsonView value={issue?.issue.metadata ?? {}} />
    </div>
  );
}

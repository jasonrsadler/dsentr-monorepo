import { useEffect, useMemo, useState } from 'react'
import {
  listWorkflows,
  type WorkflowRecord,
  getWebhookUrl,
  regenerateWebhookUrl,
  getWebhookConfig,
  setWebhookConfig
} from '@/lib/workflowApi'
import { API_BASE_URL } from '@/lib/config'

export default function WebhooksTab() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [workflowId, setWorkflowId] = useState<string>('')
  const [url, setUrl] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [regenBusy, setRegenBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [requireHmac, setRequireHmac] = useState(false)
  const [replayWindow, setReplayWindow] = useState(300)
  const [signingKey, setSigningKey] = useState('')

  useEffect(() => {
    listWorkflows()
      .then((ws) => {
        setWorkflows(ws)
        if (ws[0]) setWorkflowId(ws[0].id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!workflowId) {
      setUrl('')
      return
    }
    setLoading(true)
    getWebhookUrl(workflowId)
      .then(setUrl)
      .finally(() => setLoading(false))
  }, [workflowId])

  useEffect(() => {
    if (!workflowId) {
      setRequireHmac(false)
      setReplayWindow(300)
      setSigningKey('')
      return
    }
    getWebhookConfig(workflowId)
      .then((cfg) => {
        setRequireHmac(cfg.require_hmac)
        setReplayWindow(cfg.replay_window_sec)
        setSigningKey(cfg.signing_key)
      })
      .catch(() => {})
  }, [workflowId])

  const selected = useMemo(
    () => workflows.find((w) => w.id === workflowId) ?? null,
    [workflows, workflowId]
  )
  const base = (API_BASE_URL || '').replace(/\/$/, '')
  const fullUrl = url ? `${base}${url}` : url
  useEffect(() => {
    setCopied(false)
  }, [fullUrl])
  const curlDisplay = fullUrl
    ? `curl -X POST \\\n+  -H "Content-Type: application/json" \\\n+  -d '{"price":"123"}' \\\n+  ${fullUrl}`
    : ''
  const curlCopy = fullUrl
    ? `curl -X POST -H "Content-Type: application/json" -d '{"price":"123"}' ${fullUrl}`
    : ''
  const psDisplay = fullUrl
    ? `Invoke-RestMethod -Method POST \`\n  -Uri "${fullUrl}" \`\n  -ContentType "application/json" \`\n  -Body '{"price":"123"}'`
    : ''
  const psCopy = fullUrl
    ? `Invoke-RestMethod -Method POST -Uri "${fullUrl}" -ContentType "application/json" -Body '{"price":"123"}'`
    : ''
  const jsDisplay = fullUrl
    ? `await fetch("${fullUrl}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ price: "123" })\n});`
    : ''
  const jsCopy = jsDisplay
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [copiedPS, setCopiedPS] = useState(false)
  const [copiedJS, setCopiedJS] = useState(false)
  useEffect(() => {
    setCopiedCurl(false)
    setCopiedPS(false)
    setCopiedJS(false)
  }, [fullUrl])

  return (
    <div className="space-y-4 relative">
      <div className="flex items-center gap-2">
        <label className="text-sm">Workflow</label>
        <select
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
          className="px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
        >
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {selected && (
          <span className="text-sm text-zinc-600 dark:text-zinc-300">
            Selected: <span className="font-medium">{selected.name}</span>
          </span>
        )}
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
        <h3 className="font-semibold mb-2">Webhook URL</h3>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : fullUrl ? (
          <div className="flex items-center gap-2">
            <code className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 break-all">
              {fullUrl}
            </code>
            <button
              className="text-xs px-2 py-1 rounded border"
              onClick={async () => {
                try {
                  if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(fullUrl)
                  } else {
                    const ta = document.createElement('textarea')
                    ta.value = fullUrl
                    document.body.appendChild(ta)
                    ta.select()
                    document.execCommand('copy')
                    document.body.removeChild(ta)
                  }
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {}
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No URL</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            className="text-xs px-2 py-1 rounded border whitespace-nowrap"
            disabled={!workflowId || regenBusy}
            onClick={() => {
              if (workflowId) setConfirming(true)
            }}
          >
            {regenBusy ? 'Regenerating…' : 'Regenerate Token'}
          </button>
          <span className="text-xs text-zinc-500">
            Use this if the URL leaked or as part of periodic credential
            rotation. Update any external integrations afterward.
          </span>
        </div>
        <div className="mt-4 text-xs text-zinc-600 dark:text-zinc-300 space-y-2">
          <div>
            <span className="font-medium">Payload</span>: POST JSON
            (Content-Type: application/json). The body becomes trigger context
            and is available in templating (e.g., <code>{'{{price}}'}</code>).
          </div>
          <div>
            <span className="font-medium">Response</span>: 202 Accepted →{' '}
            <code>{'{ run: { id, ... } }'}</code>. Poll GET{' '}
            <code>/api/workflows/&lt;id&gt;/runs/&lt;run_id&gt;</code> for
            status.
          </div>
          <div className="space-y-2 hidden">
            <div className="font-medium">Examples</div>
            <div className="relative">
              <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                curl
              </span>
              <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto">
                <code>{`curl -X POST -H "Content-Type: application/json" -d '{"price":"123"}' ${fullUrl}`}</code>
              </pre>
            </div>
            <div className="relative">
              <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                powershell
              </span>
              <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto">
                <code>{`Invoke-RestMethod -Method POST -Uri "${fullUrl}" -ContentType "application/json" -Body '{"price":"123"}'`}</code>
              </pre>
            </div>
            <div className="relative">
              <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                javascript
              </span>
              <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto">
                <code>{`await fetch("${fullUrl}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ price: "123" })
});`}</code>
              </pre>
            </div>
          </div>
        </div>

        {/* Wrapped examples with copy buttons */}
        <div className="mt-3 space-y-2">
          <div className="font-medium text-xs">Examples</div>
          <div className="relative">
            <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
              curl
            </span>
            <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto whitespace-pre-wrap break-words text-[11px]">
              <code>{curlDisplay}</code>
            </pre>
            <div className="text-right mt-1">
              <button
                className="text-[10px] px-2 py-0.5 rounded border"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(curlCopy)
                  } catch {}
                  setCopiedCurl(true)
                  setTimeout(() => setCopiedCurl(false), 1500)
                }}
              >
                {copiedCurl ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="relative">
            <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
              powershell
            </span>
            <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto whitespace-pre-wrap break-words text-[11px]">
              <code>{psDisplay}</code>
            </pre>
            <div className="text-right mt-1">
              <button
                className="text-[10px] px-2 py-0.5 rounded border"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(psCopy)
                  } catch {}
                  setCopiedPS(true)
                  setTimeout(() => setCopiedPS(false), 1500)
                }}
              >
                {copiedPS ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="relative">
            <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
              javascript
            </span>
            <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto whitespace-pre-wrap break-words text-[11px]">
              <code>{jsDisplay}</code>
            </pre>
            <div className="text-right mt-1">
              <button
                className="text-[10px] px-2 py-0.5 rounded border"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(jsCopy)
                  } catch {}
                  setCopiedJS(true)
                  setTimeout(() => setCopiedJS(false), 1500)
                }}
              >
                {copiedJS ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs text-zinc-500 mt-2">
          Send a POST with JSON payload to this URL to start the workflow. The
          request body becomes the trigger context (available in templating as{' '}
          <code>{'{{key}}'}</code>).
        </p>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
        <h3 className="font-semibold mb-2">HMAC Verification</h3>
        <div className="flex items-center gap-3 mb-2">
          <label className="text-sm inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={requireHmac}
              onChange={(e) => setRequireHmac(e.target.checked)}
            />
            Require HMAC signature
          </label>
          <label className="text-sm inline-flex items-center gap-2">
            Replay window (sec)
            <input
              type="number"
              min={60}
              max={3600}
              value={replayWindow}
              onChange={(e) =>
                setReplayWindow(parseInt(e.target.value || '300', 10))
              }
              className="w-24 px-2 py-1 border rounded bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
            />
          </label>
          <button
            className="text-xs px-2 py-1 rounded border"
            onClick={async () => {
              try {
                await setWebhookConfig(workflowId, {
                  require_hmac: requireHmac,
                  replay_window_sec: replayWindow
                })
              } catch {}
            }}
          >
            Save
          </button>
        </div>
        <div className="mb-2">
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            Signing key (base64url):
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 break-all">
              {signingKey || '(unavailable)'}
            </code>
            <button
              className="text-xs px-2 py-1 rounded border"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(signingKey)
                } catch {}
              }}
            >
              Copy
            </button>
          </div>
        </div>
        <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
          <div>Client should send headers:</div>
          <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded text-[11px] overflow-auto">{`X-Dsentr-Timestamp: <unix-seconds>\nX-Dsentr-Signature: v1=<hex(hmac_sha256(signing_key, ts + '.' + raw_json_body))>`}</pre>
        </div>
      </div>

      {confirming && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
          <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow-xl w-96 border border-zinc-200 dark:border-zinc-700">
            <h4 className="font-semibold mb-2 text-sm">
              Regenerate webhook token?
            </h4>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 mb-3">
              Old URLs will stop working immediately. You will need to update
              any external integrations.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 text-xs rounded border"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                disabled={regenBusy}
                onClick={async () => {
                  if (!workflowId) return
                  try {
                    setRegenBusy(true)
                    const newUrl = await regenerateWebhookUrl(workflowId)
                    setUrl(newUrl)
                    setConfirming(false)
                  } finally {
                    setRegenBusy(false)
                  }
                }}
              >
                {regenBusy ? 'Regenerating…' : 'Confirm Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

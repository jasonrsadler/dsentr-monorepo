/* eslint-disable prettier/prettier */
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
import { errorMessage } from '@/lib/errorMessage'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import { normalizePlanTier } from '@/lib/planTiers'

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
  const [saveBusy, setSaveBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [copiedPS, setCopiedPS] = useState(false)
  const [copiedJS, setCopiedJS] = useState(false)

  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const activeWorkspaceId = currentWorkspace?.workspace.id ?? null
  const canManageWebhooks =
    currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin'
  const manageWebhooksPermissionMessage =
    'Only workspace admins or owners can manage webhook settings.'
  const planTier = normalizePlanTier(currentWorkspace?.workspace.plan ?? null)
  const isSoloPlan = planTier === 'solo'

  // Load available workflows for the active workspace (or personal)
  useEffect(() => {
    listWorkflows(activeWorkspaceId)
      .then((ws) => {
        setWorkflows(ws)
        setWorkflowId((prev) => {
          if (prev && ws.some((w) => w.id === prev)) return prev
          return ws[0]?.id ?? ''
        })
      })
      .catch(() => {})
  }, [activeWorkspaceId])

  // Fetch webhook URL for selected workflow
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

  // Fetch HMAC config
  useEffect(() => {
    if (!workflowId) {
      setRequireHmac(false)
      setReplayWindow(300)
      setSigningKey('')
      return
    }
    getWebhookConfig(workflowId)
      .then((cfg) => {
        setRequireHmac(!!cfg.require_hmac)
        setReplayWindow(Number(cfg.replay_window_sec) || 300)
        setSigningKey(cfg.signing_key || '')
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
                } catch (e) {
                  console.error(errorMessage(e))
                }
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
            disabled={!workflowId || regenBusy || !canManageWebhooks}
            onClick={() => {
              if (!canManageWebhooks) return
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
        {!canManageWebhooks && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
            You have read-only access. {manageWebhooksPermissionMessage}
          </p>
        )}

        {/* Examples (basic, no HMAC) */}
        <div className="mt-3 space-y-2">
          <div className="font-medium text-xs">Examples</div>

          {/* curl */}
          <div className="relative">
            <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
              curl
            </span>
            <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto themed-scroll whitespace-pre-wrap break-words text-[11px]">
              <code>
                {fullUrl
                  ? `curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"price":"123"}' \\
  ${fullUrl}`
                  : ''}
              </code>
            </pre>
            <div className="text-right mt-1">
              <button
                className="text-[10px] px-2 py-0.5 rounded border"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      fullUrl
                        ? `curl -X POST -H "Content-Type: application/json" -d '{"price":"123"}' ${fullUrl}`
                        : ''
                    )
                  } catch (e) {
                    console.error(errorMessage(e))
                  }
                  setCopiedCurl(true)
                  setTimeout(() => setCopiedCurl(false), 1500)
                }}
              >
                {copiedCurl ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* PowerShell */}
          <div className="relative">
            <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
              powershell
            </span>
            <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto themed-scroll whitespace-pre-wrap break-words text-[11px]">
              <code>
                {fullUrl
                  ? `Invoke-RestMethod -Method POST \`\n  -Uri "${fullUrl}" \`\n  -ContentType "application/json" \`\n  -Body '{"price":"123"}'`
                  : ''}
              </code>
            </pre>
            <div className="text-right mt-1">
              <button
                className="text-[10px] px-2 py-0.5 rounded border"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      fullUrl
                        ? `Invoke-RestMethod -Method POST -Uri "${fullUrl}" -ContentType "application/json" -Body '{"price":"123"}'`
                        : ''
                    )
                  } catch (e) {
                    console.error(errorMessage(e))
                  }
                  setCopiedPS(true)
                  setTimeout(() => setCopiedPS(false), 1500)
                }}
              >
                {copiedPS ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* JavaScript */}
          <div className="relative">
            <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
              javascript
            </span>
            <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto themed-scroll whitespace-pre-wrap break-words text-[11px]">
              <code>
                {fullUrl
                  ? `await fetch("${fullUrl}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ price: "123" })\n});`
                  : ''}
              </code>
            </pre>
            <div className="text-right mt-1">
              <button
                className="text-[10px] px-2 py-0.5 rounded border"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      fullUrl
                        ? `await fetch("${fullUrl}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ price: "123" })\n});`
                        : ''
                    )
                  } catch (e) {
                    console.error(errorMessage(e))
                  }
                  setCopiedJS(true)
                  setTimeout(() => setCopiedJS(false), 1500)
                }}
              >
                {copiedJS ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
        <h3 className="font-semibold mb-2">HMAC Verification</h3>
        {!canManageWebhooks && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
            You have read-only access. {manageWebhooksPermissionMessage}
          </p>
        )}
        {isSoloPlan && (
          /* eslint-disable prettier/prettier */
          <div className="text-xs text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
            <span>
              HMAC verification is available on workspace plans. Upgrade your plan
              to enable it.
            </span>
            <button
              type="button"
              className="px-2 py-0.5 text-[10px] rounded border"
              onClick={() => {
                try {
                  window.dispatchEvent(
                    new CustomEvent('open-plan-settings', {
                      detail: { tab: 'plan' }
                    })
                  )
                } catch (err) {
                  console.error(errorMessage(err))
                }
              }}
            >
              Upgrade
            </button>
          </div>
          /* eslint-enable prettier/prettier */
        )}
        <div className="flex items-center gap-3 mb-2">
          <label className="text-sm inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={requireHmac}
              onChange={(e) => setRequireHmac(e.target.checked)}
              disabled={!canManageWebhooks || isSoloPlan}
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
              disabled={!canManageWebhooks || isSoloPlan}
            />
          </label>
          <button
            className="text-xs px-2 py-1 rounded border"
            disabled={!canManageWebhooks || isSoloPlan || saveBusy}
            onClick={async () => {
              if (!canManageWebhooks || !workflowId) return
              try {
                setSaveBusy(true)
                await setWebhookConfig(workflowId, {
                  require_hmac: requireHmac,
                  replay_window_sec: replayWindow
                })
                setJustSaved(true)
                setTimeout(() => setJustSaved(false), 1500)
              } catch (e) {
                console.error(errorMessage(e))
              } finally {
                setSaveBusy(false)
              }
            }}
          >
            {saveBusy ? 'Saving…' : justSaved ? 'Saved!' : 'Save'}
          </button>
        </div>
        {!isSoloPlan && (
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
                  } catch (e) {
                    console.error(errorMessage(e))
                  }
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {/* HMAC client guidance (headers/legacy) */}
        {!isSoloPlan && (
          <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-2">
            <div>Client should send headers (preferred):</div>
            <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded text-[11px] overflow-auto themed-scroll">
              {`X-DSentr-Timestamp: <unix-seconds>\nX-DSentr-Signature: v1=<hex(hmac_sha256(base64url_decode(signing_key), ts + '.' + canonical_json_body))>`}
            </pre>
            <div className="text-xs text-zinc-500">
              canonical_json_body is the minified JSON string (no whitespace).{' '}
              The server verifies the HMAC over{' '}
              <code>ts + '.' + canonical_json_body</code>.
            </div>
            <div className="text-xs text-zinc-500">
              Legacy: if headers aren't used, include <code>_dsentr_ts</code>{' '}
              and <code>_dsentr_sig</code> in the body and sign{' '}
              <code>ts + '.' + body_without(_dsentr_ts,_dsentr_sig)</code>.
            </div>
          </div>
        )}

        {/* HMAC Examples (only when enabled and not on Solo) */}
        {!isSoloPlan && requireHmac && fullUrl && signingKey && (
          <div className="mt-3 space-y-2">
            <div className="font-medium text-xs">HMAC Examples</div>

            {/* curl (bash) */}
            <div className="relative">
              <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                curl (bash)
              </span>
              <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto themed-scroll whitespace-pre-wrap break-words text-[11px]">
                <code>{`export SIGNING_KEY_B64URL='${signingKey}'
export URL='${fullUrl}'
body='{"price":"123"}'
ts=$(date +%s)
canonical=$(python3 - <<'PY' "$body"
import json,sys; print(json.dumps(json.loads(sys.argv[1]), separators=(",",":")))
PY
)
sig=$(python3 - <<'PY' "$SIGNING_KEY_B64URL" "$ts.$canonical"
import base64,hmac,hashlib,sys
k=sys.argv[1]; k+= '='*((4-len(k)%4)%4)
print(hmac.new(base64.urlsafe_b64decode(k), sys.argv[2].encode(), hashlib.sha256).hexdigest())
PY
)
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-DSentr-Timestamp: $ts" \
  -H "X-DSentr-Signature: v1=$sig" \
  -d "$canonical" \
  "$URL"`}</code>
              </pre>
            </div>

            {/* PowerShell */}
            <div className="relative">
              <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                powershell
              </span>
              <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto themed-scroll whitespace-pre-wrap break-words text-[11px]">
                <code>{`$SIGNING_KEY_B64URL = '${signingKey}'
$URL = '${fullUrl}'
$body = '{"price":"123"}'
$canonical = ($body | ConvertFrom-Json) | ConvertTo-Json -Compress
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
function Decode-Base64Url([string]$s){ $pad=(4-($s.Length%4))%4; $s+=('='*$pad); $s=$s.Replace('-','+').Replace('_','/'); [Convert]::FromBase64String($s) }
$keyBytes = Decode-Base64Url $SIGNING_KEY_B64URL
$hmac = New-Object System.Security.Cryptography.HMACSHA256($keyBytes)
$payload = [Text.Encoding]::UTF8.GetBytes($ts + '.' + $canonical)
$sigHex = -join ($hmac.ComputeHash($payload) | ForEach-Object { $_.ToString('x2') })
$headers = @{ 'Content-Type'='application/json'; 'X-DSentr-Timestamp'=$ts; 'X-DSentr-Signature'='v1=' + $sigHex }
Invoke-RestMethod -Method POST -Uri $URL -Headers $headers -Body $canonical`}</code>
              </pre>
            </div>

            {/* JavaScript (Node) */}
            <div className="relative">
              <span className="absolute right-2 top-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200">
                javascript (node)
              </span>
              <pre className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto themed-scroll whitespace-pre-wrap break-words text-[11px]">
                <code>{`// Node 18+ (global fetch). Replace signing key and URL.
const keyB64Url = '${signingKey}';
const url = '${fullUrl}';
const body = { price: '123' };
const ts = Math.floor(Date.now()/1000).toString();
const canonical = JSON.stringify(body);
const pad = '='.repeat((4 - (keyB64Url.length % 4)) % 4);
const key = Buffer.from(keyB64Url.replace(/-/g,'+').replace(/_/g,'/') + pad, 'base64');
import crypto from 'node:crypto';
const sigHex = crypto.createHmac('sha256', key).update(ts + '.' + canonical).digest('hex');
await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-DSentr-Timestamp': ts,
    'X-DSentr-Signature': 'v1=' + sigHex
  },
  body: canonical
});`}</code>
              </pre>
            </div>
          </div>
        )}
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
                disabled={regenBusy || !canManageWebhooks}
                onClick={async () => {
                  if (!canManageWebhooks) return
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

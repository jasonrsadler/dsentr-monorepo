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

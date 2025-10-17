import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'
import ActionTypeDropdown from './ActionTypeDropdown'
import ActionServiceDropdown from './ActionServiceDropdown'
import SendGridAction from './Actions/Email/Services/SendGridAction'
import NodeInputField from '../UI/InputFields/NodeInputField'
import NodeCheckBoxField from '../UI/InputFields/NodeCheckboxField'
import NodeHeader from '../UI/ReactFlow/NodeHeader'
import MailGunAction from './Actions/Email/Services/MailGunAction'
import SMTPAction from './Actions/Email/Services/SMTPAction'
import AmazonSESAction from './Actions/Email/Services/AmazonSESAction'
import WebhookAction from './Actions/Webhook/Webhook'
import MessagingAction from './Actions/Messaging/MessagingAction'
import SheetsAction from './Actions/Google/SheetsAction'
import HttpRequestAction from './Actions/HttpRequestAction'
import RunCustomCodeAction from './Actions/RunCustomCodeAction'
import { normalizePlanTier } from '@/lib/planTiers'

const PLAN_RESTRICTION_MESSAGES = {
  sheets:
    'Google Sheets actions are available on workspace plans and above. Upgrade in Settings → Plan to run this step.',
  slack:
    'Slack messaging is available on workspace plans and above. Switch this action to Google Chat or upgrade in Settings → Plan.',
  teams:
    'Microsoft Teams messaging is available on workspace plans and above. Switch this action to Google Chat or upgrade in Settings → Plan.'
} as const

function normalizeActionType(value: any): string {
  if (typeof value !== 'string') return 'email'
  const lowered = value.trim().toLowerCase()
  switch (lowered) {
    case 'send email':
      return 'email'
    case 'post webhook':
      return 'webhook'
    case 'create google sheet row':
      return 'sheets'
    case 'http request':
      return 'http'
    case 'run custom code':
      return 'code'
    default:
      return lowered || 'email'
  }
}

interface ActionNodeProps {
  id: string
  data: any
  selected: boolean
  onRun?: (id: string, params: any) => Promise<void>
  onRemove?: (id: string) => void
  onDirtyChange?: (dirty: boolean, data: any) => void
  onUpdateNode?: (id: string, data: any, suppressDirty?: boolean) => void
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
}

export default function ActionNode({
  id,
  data,
  selected,
  onRun,
  onRemove,
  onDirtyChange,
  onUpdateNode,
  isRunning,
  isSucceeded,
  isFailed,
  planTier,
  onRestrictionNotice
}: ActionNodeProps) {
  const normalizedPlanTier = useMemo(
    () => normalizePlanTier(planTier),
    [planTier]
  )
  const isSoloPlan = normalizedPlanTier === 'solo'
  const isNewNode = !data?.id

  const [expanded, setExpanded] = useState(data?.expanded ?? false)
  const [dirty, setDirty] = useState(data?.dirty ?? isNewNode)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [running, setRunning] = useState(false)
  const [actionType, setActionType] = useState<string>(
    normalizeActionType(data?.actionType)
  )
  const [params, setParams] = useState(() => ({
    service: '',
    ...(data?.params || data?.inputs || {})
  }))
  const [timeout, setTimeoutMs] = useState(data?.timeout || 5000)
  const [retries, setRetries] = useState(data?.retries || 0)
  const [stopOnError, setStopOnError] = useState(data?.stopOnError ?? true)
  const [_, setConfig] = useState(() => data || { type: '', params: {} })
  const [label, setLabel] = useState(data?.label || 'Action')
  const [labelError, setLabelError] = useState<string | null>(
    data?.labelError ?? null
  )

  useEffect(() => {
    setConfig(data || { type: '', params: {} })
  }, [data])

  // Reset local state when node id changes (e.g., new node or remount on workflow switch)
  useEffect(() => {
    setLabel(data?.label || 'Action')
    setExpanded(data?.expanded ?? false)
    setActionType(normalizeActionType(data?.actionType))
    setParams(() => ({ service: '', ...(data?.params || data?.inputs || {}) }))
    setTimeoutMs(data?.timeout || 5000)
    setRetries(data?.retries || 0)
    setStopOnError(data?.stopOnError ?? true)
    setDirty(data?.dirty ?? isNewNode)
  }, [id])

  useEffect(() => {
    if (data?.dirty !== undefined && data.dirty !== dirty) {
      console.log('Sync dirty from parent:', data.dirty)
      setDirty(data.dirty)
    }
  }, [data?.dirty])

  const [prevService, setPrevService] = useState('')

  const [hasValidationErrors, setHasValidationErrors] = useState(false)
  const normalizedActionType = useMemo(
    () => actionType.toLowerCase(),
    [actionType]
  )
  const normalizedMessagingPlatform = useMemo(() => {
    if (!params || typeof (params as any).platform !== 'string') return ''
    return ((params as any).platform as string).trim().toLowerCase()
  }, [params])
  const messagingRestrictionKey = useMemo(() => {
    if (!isSoloPlan) return null
    if (normalizedActionType !== 'messaging') return null
    if (normalizedMessagingPlatform === 'slack') return 'slack' as const
    if (normalizedMessagingPlatform === 'teams') return 'teams' as const
    return null
  }, [isSoloPlan, normalizedActionType, normalizedMessagingPlatform])
  const planRestrictionMessage = useMemo(() => {
    if (!isSoloPlan) return null
    if (normalizedActionType === 'sheets') {
      return PLAN_RESTRICTION_MESSAGES.sheets
    }
    if (messagingRestrictionKey) {
      return PLAN_RESTRICTION_MESSAGES[messagingRestrictionKey]
    }
    return null
  }, [isSoloPlan, normalizedActionType, messagingRestrictionKey])
  const combinedHasValidationErrors =
    hasValidationErrors ||
    Boolean(labelError) ||
    Boolean(planRestrictionMessage)
  const lastPlanNoticeRef = useRef<string | null>(null)

  useEffect(() => {
    setLabelError(data?.labelError ?? null)
  }, [data?.labelError])

  useEffect(() => {
    if (!onRestrictionNotice) return
    if (planRestrictionMessage) {
      if (lastPlanNoticeRef.current === planRestrictionMessage) return
      lastPlanNoticeRef.current = planRestrictionMessage
      onRestrictionNotice(planRestrictionMessage)
    } else {
      lastPlanNoticeRef.current = null
    }
  }, [planRestrictionMessage, onRestrictionNotice])

  useEffect(() => {
    if (!isSoloPlan) return
    if (normalizedActionType !== 'messaging') return
    setParams((prev) => {
      if (!prev || typeof prev !== 'object') return prev
      const platform =
        typeof (prev as any).platform === 'string'
          ? ((prev as any).platform as string)
          : ''
      if (platform && platform.trim()) return prev
      return { ...prev, platform: 'Google Chat' }
    })
  }, [isSoloPlan, normalizedActionType])

  const openPlanSettings = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error((err as Error).message)
    }
  }, [])

  useEffect(() => {
    if (params.service !== prevService) {
      setParams((prev) => {
        switch (params.service.toLowerCase()) {
          case 'mailgun':
            return { ...prev, region: prev.region || 'US (api.mailgun.net)' }
          case 'amazon ses':
            return {
              ...prev,
              awsRegion: prev.awsRegion || 'us-east-1',
              sesVersion: prev.sesVersion || 'v2'
            }
          default:
            return prev
        }
      })
      setPrevService(params.service || '')
    }
  }, [params.service, prevService])

  useEffect(() => {
    onUpdateNode?.(
      id,
      {
        label,
        actionType: normalizedActionType,
        params,
        timeout,
        retries,
        stopOnError,
        dirty,
        expanded,
        hasValidationErrors: combinedHasValidationErrors
      },
      true
    )

    if (dirty) {
      onDirtyChange?.(true, {
        label,
        actionType: normalizedActionType,
        params,
        timeout,
        retries,
        stopOnError,
        expanded,
        hasValidationErrors: combinedHasValidationErrors
      })
    }
  }, [
    label,
    actionType,
    params,
    timeout,
    retries,
    stopOnError,
    dirty,
    expanded,
    hasValidationErrors,
    combinedHasValidationErrors,
    onUpdateNode,
    id,
    onDirtyChange,
    normalizedActionType
  ])

  const handleRun = async () => {
    setRunning(true)
    try {
      await onRun?.(id, params)
    } finally {
      setRunning(false)
    }
  }

  const ringClass = isFailed
    ? 'ring-2 ring-red-500'
    : isSucceeded
      ? 'ring-2 ring-emerald-500'
      : isRunning
        ? 'ring-2 ring-sky-500'
        : ''
  return (
    <motion.div
      className={`wf-node relative rounded-2xl shadow-md border bg-white dark:bg-zinc-900 transition-all ${selected ? 'ring-2 ring-blue-500' : 'border-zinc-300 dark:border-zinc-700'} ${ringClass}`}
      style={{
        width: expanded ? 'auto' : 256,
        minWidth: expanded ? 256 : undefined,
        maxWidth: expanded ? 400 : undefined
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 14,
          height: 14,
          backgroundColor: 'blue',
          border: '2px solid white'
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 14,
          height: 14,
          backgroundColor: 'green',
          border: '2px solid white'
        }}
      />
      <div className="p-3">
        <NodeHeader
          label={label}
          dirty={dirty}
          hasValidationErrors={combinedHasValidationErrors}
          expanded={expanded}
          onLabelChange={(val) => {
            setLabel(val)
            setDirty(true)
          }}
          onExpanded={() => setExpanded((prev) => !prev)}
          onConfirmingDelete={() => setConfirmingDelete(true)}
        />
        {labelError && (
          <p className="mt-2 text-xs text-red-500">{labelError}</p>
        )}
        <button
          onClick={handleRun}
          disabled={running || combinedHasValidationErrors}
          className="mt-2 w-full py-1 text-sm rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
        >
          {running ? 'Testing...' : 'Test Action'}
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              key="expanded-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-2"
            >
              <p className="text-xs text-zinc-500">Action Type</p>
              <ActionTypeDropdown
                value={normalizedActionType}
                onChange={(t) => {
                  setActionType(t)
                  setDirty(true)
                }}
                disabledOptions={
                  isSoloPlan
                    ? {
                        sheets: PLAN_RESTRICTION_MESSAGES.sheets
                      }
                    : {}
                }
                onBlockedSelect={(id, reason) => {
                  if (!onRestrictionNotice) return
                  const fallback =
                    id === 'sheets'
                      ? PLAN_RESTRICTION_MESSAGES.sheets
                      : 'This action is locked on your current plan.'
                  onRestrictionNotice(reason || fallback)
                }}
              />
              {normalizedActionType === 'sheets' && planRestrictionMessage ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
                  <div className="flex items-start justify-between gap-2">
                    <span>{planRestrictionMessage}</span>
                    <button
                      type="button"
                      onClick={openPlanSettings}
                      className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-400/10"
                    >
                      Upgrade
                    </button>
                  </div>
                </div>
              ) : null}
              {normalizedActionType === 'webhook' && (
                <div className="flex flex-col gap-2">
                  <WebhookAction
                    args={params}
                    onChange={(updatedParams, nodeHasErrors, childDirty) => {
                      setParams((prev) => ({ ...prev, ...updatedParams }))
                      setHasValidationErrors(nodeHasErrors)
                      setDirty((prev) => childDirty || prev)
                    }}
                  />
                </div>
              )}
              {normalizedActionType === 'email' && (
                <div className="flex flex-col gap-2">
                  <ActionServiceDropdown
                    value={params.service}
                    onChange={(val) => {
                      setParams((prev) => ({ ...prev, service: val }))
                      setDirty(true)
                    }}
                  />
                  {params.service === 'Mailgun' && (
                    <MailGunAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        setParams((prev) => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty((prev) => childDirty || prev)
                      }}
                    />
                  )}
                  {params.service === 'SendGrid' && (
                    <SendGridAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        setParams((prev) => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty((prev) => childDirty || prev)
                      }}
                    />
                  )}
                  {params.service === 'SMTP' && (
                    <SMTPAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        setParams((prev) => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty((prev) => childDirty || prev)
                      }}
                    />
                  )}
                  {params.service === 'Amazon SES' && (
                    <AmazonSESAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        setParams((prev) => ({ ...prev, ...updatedParams }))
                        setHasValidationErrors(nodeHasErrors)
                        setDirty((prev) => childDirty || prev)
                      }}
                    />
                  )}
                </div>
              )}
              {normalizedActionType === 'messaging' && (
                <MessagingAction
                  args={params}
                  onChange={(updatedParams, nodeHasErrors, childDirty) => {
                    setParams((prev) => ({ ...prev, ...updatedParams }))
                    setHasValidationErrors(nodeHasErrors)
                    setDirty((prev) => childDirty || prev)
                  }}
                  disabledPlatforms={
                    isSoloPlan
                      ? {
                          Slack: PLAN_RESTRICTION_MESSAGES.slack,
                          Teams: PLAN_RESTRICTION_MESSAGES.teams
                        }
                      : {}
                  }
                  restrictedPlatform={messagingRestrictionKey}
                  restrictionMessage={
                    messagingRestrictionKey
                      ? PLAN_RESTRICTION_MESSAGES[messagingRestrictionKey]
                      : null
                  }
                  onRestrictionNotice={onRestrictionNotice}
                  onUpgradeClick={openPlanSettings}
                />
              )}
              {normalizedActionType === 'sheets' && !planRestrictionMessage && (
                <SheetsAction
                  args={params}
                  onChange={(updatedParams, nodeHasErrors, childDirty) => {
                    setParams((prev) => ({ ...prev, ...updatedParams }))
                    setHasValidationErrors(nodeHasErrors)
                    setDirty((prev) => childDirty || prev)
                  }}
                />
              )}
              {normalizedActionType === 'http' && (
                <HttpRequestAction
                  args={params}
                  onChange={(updatedParams, nodeHasErrors, childDirty) => {
                    setParams((prev) => ({ ...prev, ...updatedParams }))
                    setHasValidationErrors(nodeHasErrors)
                    setDirty((prev) => childDirty || prev)
                  }}
                />
              )}
              {normalizedActionType === 'code' && (
                <RunCustomCodeAction
                  args={{
                    code: params.code || '',
                    inputs: params.inputs || [],
                    outputs: params.outputs || [],
                    dirty
                  }}
                  onChange={(updatedParams, nodeHasErrors, childDirty) => {
                    setParams((prev) => ({ ...prev, ...updatedParams }))
                    setHasValidationErrors(nodeHasErrors)
                    setDirty((prev) => childDirty || prev)
                  }}
                />
              )}
              <p className="text-xs text-zinc-500">Execution Options</p>
              <div className="flex gap-2 items-center">
                <NodeInputField
                  type="number"
                  value={timeout}
                  onChange={(val) => {
                    setTimeoutMs(Number(val))
                    setDirty(true)
                  }}
                  className="w-20 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                />
                <span className="text-xs">ms timeout</span>
                <NodeInputField
                  type="number"
                  value={retries}
                  onChange={(val) => {
                    setRetries(Number(val))
                    setDirty(true)
                  }}
                  className="w-12 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                />
                <span className="text-xs">retries</span>
                <NodeCheckBoxField
                  checked={stopOnError}
                  onChange={(val) => {
                    setStopOnError(val)
                    setDirty(true)
                  }}
                >
                  Stop on error
                </NodeCheckBoxField>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {confirmingDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl"
          >
            <div className="bg-white dark:bg-zinc-800 p-4 rounded-xl shadow-md w-56">
              <p className="text-sm mb-3">Delete this node?</p>
              <p className="text-sm mb-3">This action can not be undone</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-2 py-1 text-xs rounded border"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setConfirmingDelete(false)
                    onRemove?.(id)
                  }}
                  className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

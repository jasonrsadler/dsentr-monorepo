import { memo, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import deepEqual from 'fast-deep-equal'
import { motion, AnimatePresence } from 'framer-motion'
import { Handle, Position } from '@xyflow/react'
import ActionTypeDropdown from './ActionTypeDropdown'
import ActionServiceDropdown from './ActionServiceDropdown'
import SendGridAction from './Actions/Email/Services/SendGridAction'
import NodeInputField from '../ui/input-fields/NodeInputField'
import NodeCheckBoxField from '../ui/input-fields/NodeCheckboxField'
import NodeHeader from '../ui/react-flow/NodeHeader'
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

type NodeStatusSnapshot = {
  isRunning: boolean
  isSucceeded: boolean
  isFailed: boolean
}

type ActionNodeData = {
  id?: string
  label?: string
  actionType?: string
  params?: Record<string, any>
  inputs?: Record<string, any>
  timeout?: number
  retries?: number
  stopOnError?: boolean
  dirty?: boolean
  expanded?: boolean
  labelError?: string | null
  hasValidationErrors?: boolean
  childHasValidationErrors?: boolean
  nodeStatus?: Partial<NodeStatusSnapshot>
  status?: Partial<NodeStatusSnapshot>
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
}

const EMPTY_PARAMS: Record<string, any> = Object.freeze({})

type NodeUpdatePayload = {
  label: string
  actionType: string
  params: Record<string, any>
  timeout: number
  retries: number
  stopOnError: boolean
  dirty: boolean
  expanded: boolean
  hasValidationErrors: boolean
  labelError: string | null
  childHasValidationErrors: boolean
}

function nodeUpdatesEqual(
  previous: NodeUpdatePayload | undefined,
  next: NodeUpdatePayload
) {
  if (!previous) {
    return false
  }
  if (previous.label !== next.label) return false
  if (previous.actionType !== next.actionType) return false
  if (!deepEqual(previous.params, next.params)) return false
  if (previous.timeout !== next.timeout) return false
  if (previous.retries !== next.retries) return false
  if (previous.stopOnError !== next.stopOnError) return false
  if (previous.dirty !== next.dirty) return false
  if (previous.expanded !== next.expanded) return false
  if (previous.hasValidationErrors !== next.hasValidationErrors) return false
  if ((previous.labelError ?? null) !== (next.labelError ?? null)) return false
  if (previous.childHasValidationErrors !== next.childHasValidationErrors) {
    return false
  }
  return true
}

function deriveNodeStatus(data?: ActionNodeData): NodeStatusSnapshot {
  if (!data) {
    return { isRunning: false, isSucceeded: false, isFailed: false }
  }

  const nested =
    (typeof data.nodeStatus === 'object' && data.nodeStatus) ||
    (typeof data.status === 'object' && data.status) ||
    {}
  const nestedRecord = nested as Record<string, unknown>

  const resolve = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value
    return Boolean(value)
  }

  const isRunning = resolve(
    data.isRunning ?? nestedRecord.isRunning ?? nestedRecord.running
  )
  const isSucceeded = resolve(
    data.isSucceeded ?? nestedRecord.isSucceeded ?? nestedRecord.succeeded
  )
  const isFailed = resolve(
    data.isFailed ?? nestedRecord.isFailed ?? nestedRecord.failed
  )

  return { isRunning, isSucceeded, isFailed }
}

interface ActionNodeProps {
  id: string
  data: any
  selected: boolean
  onRun?: (id: string, params: any) => Promise<void> | void
  onRemove?: (id: string) => void
  onChange?: (id: string, data: any, suppressDirty?: boolean) => void
  markDirty?: () => void
  planTier?: string | null
  onRestrictionNotice?: (message: string) => void
}

function ActionNode({
  id,
  data: _data,
  selected,
  onRun,
  onRemove,
  onChange,
  markDirty,
  planTier,
  onRestrictionNotice
}: ActionNodeProps) {
  const normalizedPlanTier = useMemo(
    () => normalizePlanTier(planTier),
    [planTier]
  )
  const isSoloPlan = normalizedPlanTier === 'solo'

  const nodeData = useMemo(() => (_data ?? {}) as ActionNodeData, [_data])

  const baseParams = useMemo<Record<string, any>>(() => {
    if (nodeData?.params && typeof nodeData.params === 'object') {
      return nodeData.params as Record<string, any>
    }
    if (nodeData?.inputs && typeof nodeData.inputs === 'object') {
      return nodeData.inputs as Record<string, any>
    }
    return EMPTY_PARAMS
  }, [nodeData?.inputs, nodeData?.params])

  const applyParamDefaults = useCallback(
    (candidate: Record<string, any>, nextActionType: string) => {
      let next = candidate

      const ensureValue = (key: string, value: unknown) => {
        if (next[key] === value) {
          return
        }
        next = next === candidate ? { ...candidate } : { ...next }
        next[key] = value
      }

      const normalizedType = normalizeActionType(nextActionType).toLowerCase()

      if (isSoloPlan && normalizedType === 'messaging') {
        const rawPlatform =
          typeof next?.platform === 'string' ? next.platform.trim() : ''
        if (!rawPlatform) {
          ensureValue('platform', 'Google Chat')
        }
      }

      if (normalizedType === 'email') {
        const service =
          typeof next?.service === 'string'
            ? next.service.trim().toLowerCase()
            : ''
        if (service === 'mailgun') {
          const region =
            typeof next?.region === 'string' && next.region
              ? next.region
              : 'US (api.mailgun.net)'
          ensureValue('region', region)
        }
        if (service === 'amazon ses') {
          const awsRegion =
            typeof next?.awsRegion === 'string' && next.awsRegion
              ? next.awsRegion
              : 'us-east-1'
          const sesVersion =
            typeof next?.sesVersion === 'string' && next.sesVersion
              ? next.sesVersion
              : 'v2'
          ensureValue('awsRegion', awsRegion)
          ensureValue('sesVersion', sesVersion)
        }
      }

      return next
    },
    [isSoloPlan]
  )

  const params = useMemo<Record<string, any>>(
    () => applyParamDefaults(baseParams, actionTypeValue),
    [applyParamDefaults, baseParams, actionTypeValue]
  )

  const label = nodeData?.label ?? 'Action'
  const actionTypeValue = normalizeActionType(nodeData?.actionType)
  const normalizedActionType = useMemo(
    () => actionTypeValue.toLowerCase(),
    [actionTypeValue]
  )
  const timeout = nodeData?.timeout ?? 5000
  const retries = nodeData?.retries ?? 0
  const stopOnError =
    nodeData?.stopOnError === undefined ? true : Boolean(nodeData.stopOnError)
  const isNewNode = !nodeData?.id
  const dirty = nodeData?.dirty ?? isNewNode
  const expanded = Boolean(nodeData?.expanded)
  const labelError = nodeData?.labelError ?? null
  const childHasValidationErrors = Boolean(nodeData?.childHasValidationErrors)
  const { isRunning, isSucceeded, isFailed } = useMemo(
    () => deriveNodeStatus(nodeData),
    [nodeData]
  )

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [running, setRunning] = useState(false)

  const lastNodeUpdateRef = useRef<NodeUpdatePayload | undefined>(undefined)
  const lastPlanNoticeRef = useRef<string | null>(null)

  const normalizedMessagingPlatform = useMemo(() => {
    if (typeof params?.platform !== 'string') {
      return ''
    }
    return (params.platform as string).trim().toLowerCase()
  }, [params])

  const messagingRestrictionKey = useMemo(() => {
    if (!isSoloPlan) return null
    if (normalizedActionType !== 'messaging') return null
    if (normalizedMessagingPlatform === 'slack') return 'slack' as const
    if (normalizedMessagingPlatform === 'teams') return 'teams' as const
    return null
  }, [isSoloPlan, normalizedActionType, normalizedMessagingPlatform])

  const computePlanRestrictionMessage = useCallback(
    (nextActionType: string, candidateParams: Record<string, any>) => {
      if (!isSoloPlan) return null
      const normalizedType = normalizeActionType(nextActionType).toLowerCase()
      if (normalizedType === 'sheets') {
        return PLAN_RESTRICTION_MESSAGES.sheets
      }
      if (normalizedType !== 'messaging') {
        return null
      }
      const platform =
        typeof candidateParams?.platform === 'string'
          ? (candidateParams.platform as string).trim().toLowerCase()
          : ''
      if (platform === 'slack') {
        return PLAN_RESTRICTION_MESSAGES.slack
      }
      if (platform === 'teams') {
        return PLAN_RESTRICTION_MESSAGES.teams
      }
      return null
    },
    [isSoloPlan]
  )

  const planRestrictionMessage = useMemo(
    () => computePlanRestrictionMessage(actionTypeValue, params),
    [actionTypeValue, params, computePlanRestrictionMessage]
  )

  const combinedHasValidationErrors = useMemo(
    () =>
      childHasValidationErrors ||
      Boolean(labelError) ||
      Boolean(planRestrictionMessage),
    [childHasValidationErrors, labelError, planRestrictionMessage]
  )

  useEffect(() => {
    lastNodeUpdateRef.current = undefined
  }, [id])

  const handleChange = useCallback(
    (
      partial: Partial<
        NodeUpdatePayload & { childHasValidationErrors?: boolean }
      >,
      options?: { suppressDirty?: boolean }
    ) => {
      const nextActionType = normalizeActionType(
        (partial.actionType ?? actionTypeValue) as string
      )
      const initialParams = (partial.params ?? params) as Record<string, any>
      const nextTimeout =
        partial.timeout !== undefined ? Number(partial.timeout) : timeout
      const nextRetries =
        partial.retries !== undefined ? Number(partial.retries) : retries
      const nextStopOnError =
        partial.stopOnError !== undefined
          ? Boolean(partial.stopOnError)
          : stopOnError
      const nextExpanded =
        partial.expanded !== undefined ? Boolean(partial.expanded) : expanded
      const nextDirty =
        partial.dirty !== undefined ? Boolean(partial.dirty) : dirty
      const nextLabel = partial.label ?? label
      const nextLabelError =
        partial.labelError !== undefined ? partial.labelError : labelError
      const nextChildErrors =
        partial.childHasValidationErrors !== undefined
          ? Boolean(partial.childHasValidationErrors)
          : childHasValidationErrors
      const requestedHasValidationErrors =
        partial.hasValidationErrors !== undefined
          ? Boolean(partial.hasValidationErrors)
          : undefined

      const resolvedParams = applyParamDefaults(initialParams, nextActionType)

      const restrictionMessage = computePlanRestrictionMessage(
        nextActionType,
        resolvedParams
      )
      const nextHasValidationErrors =
        requestedHasValidationErrors ??
        (nextChildErrors ||
          Boolean(nextLabelError) ||
          Boolean(restrictionMessage))

      const payload: NodeUpdatePayload = {
        label: nextLabel,
        actionType: nextActionType,
        params: resolvedParams,
        timeout: nextTimeout,
        retries: nextRetries,
        stopOnError: nextStopOnError,
        dirty: nextDirty,
        expanded: nextExpanded,
        hasValidationErrors: nextHasValidationErrors,
        labelError: nextLabelError ?? null,
        childHasValidationErrors: nextChildErrors
      }

      if (nodeUpdatesEqual(lastNodeUpdateRef.current, payload)) {
        return
      }

      lastNodeUpdateRef.current = {
        ...payload,
        params: payload.params
      }

      onChange?.(id, payload, options?.suppressDirty ?? false)

      if (!options?.suppressDirty && payload.dirty !== dirty) {
        markDirty?.()
      }
    },
    [
      actionTypeValue,
      applyParamDefaults,
      childHasValidationErrors,
      computePlanRestrictionMessage,
      dirty,
      expanded,
      id,
      label,
      labelError,
      markDirty,
      onChange,
      params,
      retries,
      stopOnError,
      timeout
    ]
  )

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

  const openPlanSettings = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error((err as Error).message)
    }
  }, [])

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
            handleChange({ label: val, dirty: true })
          }}
          onExpanded={() =>
            handleChange({ expanded: !expanded }, { suppressDirty: true })
          }
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
                  handleChange({ actionType: t, dirty: true })
                }}
                disabledOptions={
                  isSoloPlan
                    ? {
                        sheets: PLAN_RESTRICTION_MESSAGES.sheets
                      }
                    : {}
                }
                onBlockedSelect={(blockedId, reason) => {
                  if (!onRestrictionNotice) return
                  const fallback =
                    blockedId === 'sheets'
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
                      const nextParams = { ...params, ...updatedParams }
                      handleChange({
                        params: nextParams,
                        dirty: childDirty ? true : dirty,
                        childHasValidationErrors: nodeHasErrors
                      })
                    }}
                  />
                </div>
              )}
              {normalizedActionType === 'email' && (
                <div className="flex flex-col gap-2">
                  <ActionServiceDropdown
                    value={
                      typeof params?.service === 'string'
                        ? (params.service as string)
                        : ''
                    }
                    onChange={(val) => {
                      handleChange({
                        params: {
                          ...params,
                          service: val
                        },
                        dirty: true
                      })
                    }}
                  />
                  {params.service === 'Mailgun' && (
                    <MailGunAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        const nextParams = { ...params, ...updatedParams }
                        handleChange({
                          params: nextParams,
                          dirty: childDirty ? true : dirty,
                          childHasValidationErrors: nodeHasErrors
                        })
                      }}
                    />
                  )}
                  {params.service === 'SendGrid' && (
                    <SendGridAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        const nextParams = { ...params, ...updatedParams }
                        handleChange({
                          params: nextParams,
                          dirty: childDirty ? true : dirty,
                          childHasValidationErrors: nodeHasErrors
                        })
                      }}
                    />
                  )}
                  {params.service === 'SMTP' && (
                    <SMTPAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        const nextParams = { ...params, ...updatedParams }
                        handleChange({
                          params: nextParams,
                          dirty: childDirty ? true : dirty,
                          childHasValidationErrors: nodeHasErrors
                        })
                      }}
                    />
                  )}
                  {params.service === 'Amazon SES' && (
                    <AmazonSESAction
                      args={params}
                      onChange={(updatedParams, nodeHasErrors, childDirty) => {
                        const nextParams = { ...params, ...updatedParams }
                        handleChange({
                          params: nextParams,
                          dirty: childDirty ? true : dirty,
                          childHasValidationErrors: nodeHasErrors
                        })
                      }}
                    />
                  )}
                </div>
              )}
              {normalizedActionType === 'messaging' && (
                <MessagingAction
                  args={params}
                  onChange={(updatedParams, nodeHasErrors, childDirty) => {
                    const nextParams = { ...params, ...updatedParams }
                    handleChange({
                      params: nextParams,
                      dirty: childDirty ? true : dirty,
                      childHasValidationErrors: nodeHasErrors
                    })
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
                    const nextParams = { ...params, ...updatedParams }
                    handleChange({
                      params: nextParams,
                      dirty: childDirty ? true : dirty,
                      childHasValidationErrors: nodeHasErrors
                    })
                  }}
                />
              )}
              {normalizedActionType === 'http' && (
                <HttpRequestAction
                  args={params}
                  onChange={(updatedParams, nodeHasErrors, childDirty) => {
                    const nextParams = { ...params, ...updatedParams }
                    handleChange({
                      params: nextParams,
                      dirty: childDirty ? true : dirty,
                      childHasValidationErrors: nodeHasErrors
                    })
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
                    const nextParams = { ...params, ...updatedParams }
                    handleChange({
                      params: nextParams,
                      dirty: childDirty ? true : dirty,
                      childHasValidationErrors: nodeHasErrors
                    })
                  }}
                />
              )}
              <p className="text-xs text-zinc-500">Execution Options</p>
              <div className="flex gap-2 items-center">
                <NodeInputField
                  type="number"
                  value={timeout}
                  onChange={(val) => {
                    handleChange({ timeout: Number(val), dirty: true })
                  }}
                  className="w-20 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                />
                <span className="text-xs">ms timeout</span>
                <NodeInputField
                  type="number"
                  value={retries}
                  onChange={(val) => {
                    handleChange({ retries: Number(val), dirty: true })
                  }}
                  className="w-12 text-xs p-1 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent"
                />
                <span className="text-xs">retries</span>
                <NodeCheckBoxField
                  checked={stopOnError}
                  onChange={(val) => {
                    handleChange({ stopOnError: val, dirty: true })
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

export default memo(ActionNode)

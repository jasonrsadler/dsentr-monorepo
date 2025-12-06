import { useState, useEffect, useMemo, useRef, useCallback } from 'react'

import { normalizePlanTier } from '@/lib/planTiers'
import { errorMessage } from '@/lib/errorMessage'
import { useActionMeta, useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useWorkflowFlyout } from '@/components/workflow/useWorkflowFlyout'

export const PLAN_RESTRICTION_MESSAGES = {
  sheets:
    'Google Sheets actions are available on workspace plans and above. Upgrade in Settings → Plan to run this step.',
  slack:
    'Slack messaging is available on workspace plans and above. Switch this action to Google Chat or upgrade in Settings → Plan.',
  teams:
    'Microsoft Teams messaging is available on workspace plans and above. Switch this action to Google Chat or upgrade in Settings → Plan.',
  asana:
    'Asana actions are available on workspace plans and above. Upgrade in Settings → Plan to run this step.'
} as const

export type ActionNodeParams = Record<string, unknown>

export interface ActionNodeData extends Record<string, unknown> {
  id?: string
  label?: string
  expanded?: boolean
  actionType?: string
  params?: ActionNodeParams
  inputs?: ActionNodeParams
  timeout?: number
  retries?: number
  stopOnError?: boolean
  dirty?: boolean
  labelError?: string | null
  hasValidationErrors?: boolean
}

interface UseActionNodeControllerOptions {
  id: string
  nodeData: ActionNodeData | null | undefined
  planTier?: string | null
  effectiveCanEdit: boolean
  onRestrictionNotice?: (message: string) => void
  toggleExpanded: () => void
  remove: () => void
}

export interface ActionNodeController {
  label: string
  labelError: string | null
  expanded: boolean
  dirty: boolean
  confirmingDelete: boolean
  actionType: string
  params: ActionNodeParams
  timeout: number
  retries: number
  stopOnError: boolean
  planRestrictionMessage: string | null
  combinedHasValidationErrors: boolean
  isSoloPlan: boolean
  effectiveCanEdit: boolean
  handleLabelChange: (value: string) => void
  handleToggleExpanded: () => void
  requestDelete: () => void
  cancelDelete: () => void
  confirmDelete: () => void
  updateParams: (
    patch: ActionNodeParams,
    options?: { markDirty?: boolean; replace?: boolean }
  ) => void
  handleTimeoutChange: (value: number) => void
  handleRetriesChange: (value: number) => void
  handleStopOnErrorChange: (value: boolean) => void
  handlePlanUpgradeClick: () => void
  markDirty: () => void
  setValidationState: (flag: boolean) => void
}

export function useActionNodeController({
  id,
  nodeData,
  planTier,
  effectiveCanEdit,
  onRestrictionNotice,
  toggleExpanded,
  remove
}: UseActionNodeControllerOptions): ActionNodeController {
  const meta = useActionMeta(id)
  const params = useActionParams<ActionNodeParams>(id, meta.actionType)

  const [dirtyOverride, setDirtyOverride] = useState<boolean | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)

  const { isFlyoutRender } = useWorkflowFlyout()

  const labelError = nodeData?.labelError ?? null

  const label = meta.label
  const expanded = meta.expanded || isFlyoutRender
  const dirty = dirtyOverride ?? meta.dirty
  const actionType = meta.actionType
  const timeout = meta.timeout
  const retries = meta.retries
  const stopOnError = meta.stopOnError
  const hasValidationErrors = meta.hasValidationErrors

  useEffect(() => {
    setDirtyOverride(null)
  }, [meta.dirty])

  const normalizedPlanTier = useMemo(
    () => normalizePlanTier(planTier),
    [planTier]
  )

  const isSoloPlan = normalizedPlanTier === 'solo'

  const planRestrictionMessage = useMemo(() => {
    if (!isSoloPlan) return null
    if (actionType === 'sheets') {
      return PLAN_RESTRICTION_MESSAGES.sheets
    }
    if (actionType === 'asana') {
      return PLAN_RESTRICTION_MESSAGES.asana
    }
    return null
  }, [isSoloPlan, actionType])

  const combinedHasValidationErrors =
    hasValidationErrors ||
    Boolean(labelError) ||
    Boolean(planRestrictionMessage)

  const writeNodeData = useCallback(
    (patch: Partial<ActionNodeData>) => {
      if (!effectiveCanEdit) return
      updateNodeData(id, patch)
    },
    [effectiveCanEdit, id, updateNodeData]
  )

  const updateParams = useCallback(
    (
      patch: ActionNodeParams,
      options?: { markDirty?: boolean; replace?: boolean }
    ) => {
      if (!effectiveCanEdit) return

      const baseParams: ActionNodeParams = options?.replace
        ? {}
        : ((nodeData?.params ?? nodeData?.inputs ?? {}) as ActionNodeParams)

      const nextParams: Record<string, unknown> = {
        ...(baseParams && typeof baseParams === 'object' ? baseParams : {})
      }

      Object.entries(patch || {}).forEach(([key, value]) => {
        if (key === 'dirty') return
        nextParams[key] = value
      })

      writeNodeData({
        params: nextParams,
        ...(options?.markDirty ? { dirty: true } : null)
      })

      if (options?.markDirty) {
        setDirtyOverride(true)
      }
    },
    [effectiveCanEdit, nodeData?.inputs, nodeData?.params, writeNodeData]
  )

  const lastPlanNoticeRef = useRef<string | null>(null)

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

  const markDirty = useCallback(() => {
    if (!effectiveCanEdit) return
    setDirtyOverride(true)
    writeNodeData({ dirty: true })
  }, [effectiveCanEdit, writeNodeData])

  const handleLabelChange = useCallback(
    (value: string) => {
      if (!effectiveCanEdit) return
      setDirtyOverride(true)
      writeNodeData({ label: value, dirty: true })
    },
    [effectiveCanEdit, writeNodeData]
  )

  const handleToggleExpanded = useCallback(() => {
    if (!effectiveCanEdit) return
    if (isFlyoutRender) return
    toggleExpanded()
  }, [effectiveCanEdit, isFlyoutRender, toggleExpanded])

  const requestDelete = useCallback(() => {
    if (!effectiveCanEdit) return
    setConfirmingDelete(true)
  }, [effectiveCanEdit])

  const cancelDelete = useCallback(() => {
    setConfirmingDelete(false)
  }, [])

  const confirmDelete = useCallback(() => {
    setConfirmingDelete(false)
    remove()
  }, [remove])

  const handleTimeoutChange = useCallback(
    (value: number) => {
      if (!effectiveCanEdit) return
      setDirtyOverride(true)
      writeNodeData({ timeout: value, dirty: true })
    },
    [effectiveCanEdit, writeNodeData]
  )

  const handleRetriesChange = useCallback(
    (value: number) => {
      if (!effectiveCanEdit) return
      setDirtyOverride(true)
      writeNodeData({ retries: value, dirty: true })
    },
    [effectiveCanEdit, writeNodeData]
  )

  const handleStopOnErrorChange = useCallback(
    (value: boolean) => {
      if (!effectiveCanEdit) return
      setDirtyOverride(true)
      writeNodeData({ stopOnError: value, dirty: true })
    },
    [effectiveCanEdit, writeNodeData]
  )

  const handlePlanUpgradeClick = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent('open-plan-settings', { detail: { tab: 'plan' } })
      )
    } catch (err) {
      console.error(errorMessage(err))
    }
  }, [])

  const setValidationState = useCallback(
    (flag: boolean) => {
      if (!effectiveCanEdit) return
      writeNodeData({ hasValidationErrors: flag })
    },
    [effectiveCanEdit, writeNodeData]
  )

  return {
    label,
    labelError,
    expanded,
    dirty,
    confirmingDelete,
    actionType,
    params,
    timeout,
    retries,
    stopOnError,
    planRestrictionMessage,
    combinedHasValidationErrors,
    isSoloPlan,
    effectiveCanEdit,
    handleLabelChange,
    handleToggleExpanded,
    requestDelete,
    cancelDelete,
    confirmDelete,
    updateParams,
    handleTimeoutChange,
    handleRetriesChange,
    handleStopOnErrorChange,
    handlePlanUpgradeClick,
    markDirty,
    setValidationState
  }
}

export default useActionNodeController

import { useState, useCallback, type ReactNode } from 'react'
import BaseNode, { type BaseNodeRenderProps } from '../BaseNode'
import type { RunAvailability } from '@/types/runAvailability'

export type BaseActionNodeRunState = {
  canInvoke: boolean
  isInvoking: boolean
  isRunning: boolean
  isSucceeded: boolean
  isFailed: boolean
  run: (params: unknown) => Promise<void>
  blockedReason?: string | null
}

export type BaseActionNodeChildrenProps<TData extends Record<string, unknown>> =
  BaseNodeRenderProps<TData> & {
    runState: BaseActionNodeRunState
  }

interface BaseActionNodeProps<TData extends Record<string, unknown>> {
  id: string
  selected: boolean
  canEdit?: boolean
  fallbackLabel?: string
  defaultExpanded?: boolean
  defaultDirty?: boolean
  onRun?: (id: string, params: unknown) => Promise<void>
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  children: (props: BaseActionNodeChildrenProps<TData>) => ReactNode
  runAvailability?: RunAvailability
}

export default function BaseActionNode<TData extends Record<string, unknown>>({
  id,
  selected,
  canEdit,
  fallbackLabel = 'Action',
  defaultExpanded,
  defaultDirty,
  onRun,
  isRunning,
  isSucceeded,
  isFailed,
  children,
  runAvailability
}: BaseActionNodeProps<TData>) {
  const [isInvoking, setIsInvoking] = useState(false)
  const blocked = Boolean(runAvailability?.disabled)
  const runBlockedReason =
    runAvailability?.reason ?? 'Workspace run quota reached.'
  const canInvoke = typeof onRun === 'function' && !blocked

  const handleRun = useCallback(
    async (params: unknown) => {
      if (!canInvoke) return
      if (isInvoking) return
      setIsInvoking(true)
      try {
        await onRun?.(id, params)
      } finally {
        setIsInvoking(false)
      }
    },
    [canInvoke, id, isInvoking, onRun]
  )

  return (
    <BaseNode
      id={id}
      selected={selected}
      canEdit={canEdit}
      fallbackLabel={fallbackLabel}
      defaultExpanded={defaultExpanded}
      defaultDirty={defaultDirty}
    >
      {(baseProps) =>
        children({
          ...(baseProps as BaseNodeRenderProps<TData>),
          runState: {
            canInvoke,
            isInvoking,
            isRunning: Boolean(isRunning) || isInvoking,
            isSucceeded: Boolean(isSucceeded),
            isFailed: Boolean(isFailed),
            run: handleRun,
            blockedReason: blocked ? runBlockedReason : null
          }
        })
      }
    </BaseNode>
  )
}

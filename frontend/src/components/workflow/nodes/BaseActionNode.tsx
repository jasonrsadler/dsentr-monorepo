import { useState, useCallback, type ReactNode } from 'react'
import BaseNode, {
  type BaseNodeProps,
  type BaseNodeRenderProps
} from '../BaseNode'

export type BaseActionNodeRunState = {
  canInvoke: boolean
  isInvoking: boolean
  isRunning: boolean
  isSucceeded: boolean
  isFailed: boolean
  run: (params: unknown) => Promise<void>
}

export type BaseActionNodeChildrenProps<TData extends Record<string, unknown>> =
  BaseNodeRenderProps<TData> & {
    runState: BaseActionNodeRunState
  }

interface BaseActionNodeProps<TData extends Record<string, unknown>>
  extends BaseNodeProps<TData> {
  onRun?: (id: string, params: unknown) => Promise<void>
  isRunning?: boolean
  isSucceeded?: boolean
  isFailed?: boolean
  children: (props: BaseActionNodeChildrenProps<TData>) => ReactNode
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
  children
}: BaseActionNodeProps<TData>) {
  const [isInvoking, setIsInvoking] = useState(false)
  const canInvoke = typeof onRun === 'function'

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
          ...baseProps,
          runState: {
            canInvoke,
            isInvoking,
            isRunning: Boolean(isRunning) || isInvoking,
            isSucceeded: Boolean(isSucceeded),
            isFailed: Boolean(isFailed),
            run: handleRun
          }
        })
      }
    </BaseNode>
  )
}

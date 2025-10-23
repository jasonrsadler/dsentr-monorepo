import { useMemo, useCallback, type ReactNode } from 'react'
import { useWorkflowStore, type WorkflowState } from '@/stores/workflowStore'

export interface BaseNodeRenderProps<
  TData extends Record<string, unknown> = Record<string, unknown>
> {
  id: string
  selected: boolean
  label: string
  expanded: boolean
  dirty: boolean
  nodeData?:
    | (TData & {
        label?: unknown
        expanded?: unknown
        dirty?: unknown
      })
    | null
  updateData: (data: Partial<TData>) => void
  toggleExpanded: () => void
  remove: () => void
  canEdit: boolean
  storeCanEdit: boolean
  effectiveCanEdit: boolean
}

export interface BaseNodeProps<
  TData extends Record<string, unknown> = Record<string, unknown>
> {
  id: string
  selected: boolean
  canEdit?: boolean
  fallbackLabel?: string
  defaultExpanded?: boolean
  defaultDirty?: boolean
  children: (props: BaseNodeRenderProps<TData>) => ReactNode
}

type InternalNodeData<TData extends Record<string, unknown>> =
  | (TData & { label?: unknown; expanded?: unknown; dirty?: unknown })
  | undefined

type Selector<TData extends Record<string, unknown>> = (
  state: WorkflowState
) => InternalNodeData<TData>

export default function BaseNode<
  TData extends Record<string, unknown> = Record<string, unknown>
>({
  id,
  selected,
  canEdit = true,
  fallbackLabel = 'Node',
  defaultExpanded = false,
  defaultDirty = false,
  children
}: BaseNodeProps<TData>) {
  const selectNodeData = useMemo<Selector<TData>>(
    () => (state) =>
      state.nodes.find((node) => node.id === id)
        ?.data as InternalNodeData<TData>,
    [id]
  )
  const nodeData = useWorkflowStore(selectNodeData)
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const removeNode = useWorkflowStore((state) => state.removeNode)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)

  const effectiveCanEdit = canEdit && storeCanEdit

  const expanded =
    (nodeData?.expanded as boolean | undefined) ?? defaultExpanded
  const dirty = (nodeData?.dirty as boolean | undefined) ?? defaultDirty
  const rawLabel = nodeData?.label
  const label =
    typeof rawLabel === 'string' && rawLabel.trim().length > 0
      ? rawLabel
      : fallbackLabel

  const handleUpdateData = useCallback(
    (data: Partial<TData>) => {
      if (!effectiveCanEdit) return
      updateNodeData(id, data)
    },
    [effectiveCanEdit, id, updateNodeData]
  )

  const handleToggleExpanded = useCallback(() => {
    if (!effectiveCanEdit) return
    updateNodeData(id, { expanded: !expanded } as Partial<TData>)
  }, [effectiveCanEdit, id, expanded, updateNodeData])

  const handleRemove = useCallback(() => {
    if (!effectiveCanEdit) return
    removeNode(id)
  }, [effectiveCanEdit, id, removeNode])

  return children({
    id,
    selected,
    label,
    expanded,
    dirty,
    nodeData: nodeData ?? null,
    updateData: handleUpdateData,
    toggleExpanded: handleToggleExpanded,
    remove: handleRemove,
    canEdit,
    storeCanEdit,
    effectiveCanEdit
  })
}

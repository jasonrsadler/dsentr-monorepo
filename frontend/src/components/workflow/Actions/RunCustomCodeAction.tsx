import { useCallback, useEffect, useMemo, useRef } from 'react'

import NodeTextAreaField from '@/components/ui/InputFields/NodeTextAreaField'
import KeyValuePair from '@/components/ui/ReactFlow/KeyValuePair'
import {
  type RunCustomCodeActionParams,
  useActionParams
} from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

type KeyValueEntry = { key: string; value: string }

interface RunCustomCodeActionProps {
  nodeId: string
  canEdit?: boolean
}

const checkKeyValuePairs = (entries: KeyValueEntry[]): boolean => {
  const normalized = entries.map((entry) => ({
    key: entry?.key?.toString() ?? '',
    value: entry?.value?.toString() ?? ''
  }))
  const keys = normalized.map((entry) => entry.key.trim()).filter(Boolean)
  const anyBlank = normalized.some(
    (entry) => !entry.key.trim() || !entry.value.trim()
  )
  const hasDuplicateKeys = new Set(keys).size !== keys.length
  return anyBlank || hasDuplicateKeys
}

export default function RunCustomCodeAction({
  nodeId,
  canEdit = true
}: RunCustomCodeActionProps) {
  const params = useActionParams<RunCustomCodeActionParams>(nodeId, 'code')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit
  const validationRef = useRef<boolean | null>(null)

  const applyParamsPatch = useCallback(
    (patch: Partial<Omit<RunCustomCodeActionParams, 'dirty'>>) => {
      if (!effectiveCanEdit) return

      const storeState = useWorkflowStore.getState()
      const nodeList = Array.isArray(storeState?.nodes) ? storeState.nodes : []
      const targetNode = nodeList.find((node) => node.id === nodeId)

      let currentParams: RunCustomCodeActionParams | undefined
      if (targetNode?.data && typeof targetNode.data === 'object') {
        const dataRecord = targetNode.data as Record<string, unknown>
        const rawParams = dataRecord.params
        if (rawParams && typeof rawParams === 'object') {
          currentParams = rawParams as RunCustomCodeActionParams
        }
      }

      const sourceParams = currentParams ?? params
      const { dirty: _dirty, ...rest } =
        sourceParams ?? ({} as RunCustomCodeActionParams)

      updateNodeData(nodeId, {
        params: { ...rest, ...patch },
        dirty: true
      })
    },
    [effectiveCanEdit, nodeId, params, updateNodeData]
  )

  const handleCodeChange = useCallback(
    (value: string) => {
      applyParamsPatch({ code: value })
    },
    [applyParamsPatch]
  )

  const handleInputsChange = useCallback(
    (value: KeyValueEntry[]) => {
      applyParamsPatch({ inputs: value })
    },
    [applyParamsPatch]
  )

  const handleOutputsChange = useCallback(
    (value: KeyValueEntry[]) => {
      applyParamsPatch({ outputs: value })
    },
    [applyParamsPatch]
  )

  const codeHasErrors = useMemo(() => {
    const trimmed = params.code?.trim()
    if (!trimmed) return false
    try {
      new Function(trimmed)
      return false
    } catch {
      return true
    }
  }, [params.code])

  const inputsInvalid = useMemo(
    () => checkKeyValuePairs(params.inputs ?? []),
    [params.inputs]
  )
  const outputsInvalid = useMemo(
    () => checkKeyValuePairs(params.outputs ?? []),
    [params.outputs]
  )

  const hasValidationErrors = codeHasErrors || inputsInvalid || outputsInvalid

  useEffect(() => {
    if (validationRef.current === hasValidationErrors) return
    validationRef.current = hasValidationErrors
    updateNodeData(nodeId, { hasValidationErrors })
  }, [hasValidationErrors, nodeId, updateNodeData])

  return (
    <div className="flex flex-col gap-2">
      <NodeTextAreaField
        value={params.code || ''}
        placeholder="Enter custom JavaScript code"
        rows={6}
        onChange={handleCodeChange}
      />
      {codeHasErrors && (
        <p className="text-xs text-red-500">Syntax error in code</p>
      )}
      <KeyValuePair
        title="Inputs"
        variables={params.inputs || []}
        onChange={handleInputsChange}
      />
      <KeyValuePair
        title="Outputs"
        variables={params.outputs || []}
        onChange={handleOutputsChange}
      />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as acorn from 'acorn'

import NodeTextAreaField from '@/components/ui/InputFields/NodeTextAreaField'
import KeyValuePair from '@/components/ui/ReactFlow/KeyValuePair'
import {
  type RunCustomCodeActionParams,
  useActionParams
} from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'
import { HelpCircle } from 'lucide-react'

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
      acorn.parse(`function _temp() { ${trimmed} }`, { ecmaVersion: 'latest' })
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

  const [showHelp, setShowHelp] = useState(false)
  const toggleHelp = useCallback(() => setShowHelp((v) => !v), [])

  return (
    <div className="flex flex-col gap-2">
      <div className="relative self-end">
        <button
          type="button"
          aria-label="Run Code help"
          title="How inputs and outputs work"
          className="nodrag p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
          onClick={toggleHelp}
        >
          <HelpCircle size={14} />
        </button>
        {showHelp && (
          <div
            role="dialog"
            aria-label="Run Code quick tips"
            className="absolute right-0 z-20 mt-1 w-80 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-md p-2"
          >
            <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 mb-1">
              Custom Code • Quick Tips
            </p>
            <ul className="list-disc pl-4 text-[11px] leading-4 text-zinc-700 dark:text-zinc-300 space-y-1">
              <li>
                Inputs: reference values with JS template strings via the{' '}
                <span className="font-mono">inputs</span> object. Example:{' '}
                <span className="font-mono">{'${inputs.name}'}</span>. Inputs
                resolve to strings.
              </li>
              <li>
                Outputs: create key/value pairs. Key can be anything; value must
                be a named property from the JSON object you return. Example:{' '}
                <span className="font-mono">
                  return {'{'} greeting: 'Hello' {'}'}
                </span>
                , then set output value to{' '}
                <span className="font-mono">greeting</span>.
              </li>
              <li>
                Primitive return: if you{' '}
                <span className="font-mono">return 'Hello'</span> (not an
                object), do not create outputs. Reference later as{' '}
                <span className="font-mono">
                  {'${{<run code node name>.result}}'}
                </span>
                .
              </li>
            </ul>
          </div>
        )}
      </div>
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

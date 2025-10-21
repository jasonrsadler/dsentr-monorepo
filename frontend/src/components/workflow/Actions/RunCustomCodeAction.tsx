import { useEffect, useMemo, useRef, useState } from 'react'
import deepEqual from 'fast-deep-equal'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
type KeyValueEntry = { key: string; value: string }

type RunCustomCodeArgs = {
  code?: string
  inputs?: KeyValueEntry[]
  outputs?: KeyValueEntry[]
  dirty?: boolean
}

type NormalizedParams = {
  code: string
  inputs: KeyValueEntry[]
  outputs: KeyValueEntry[]
}

const normalizePairs = (entries?: KeyValueEntry[]): KeyValueEntry[] => {
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const key = typeof entry.key === 'string' ? entry.key : ''
      const value = typeof entry.value === 'string' ? entry.value : ''
      return { key, value }
    })
    .filter((entry): entry is KeyValueEntry => Boolean(entry))
}

const normalizeParams = (incoming?: RunCustomCodeArgs): NormalizedParams => ({
  code: typeof incoming?.code === 'string' ? incoming.code : '',
  inputs: normalizePairs(incoming?.inputs),
  outputs: normalizePairs(incoming?.outputs)
})

const cloneParams = (params: NormalizedParams): NormalizedParams => ({
  code: params.code,
  inputs: params.inputs.map((entry) => ({ ...entry })),
  outputs: params.outputs.map((entry) => ({ ...entry }))
})

const serializeParams = (params: NormalizedParams) =>
  JSON.stringify({
    code: params.code,
    inputs: params.inputs.map((entry) => ({ ...entry })),
    outputs: params.outputs.map((entry) => ({ ...entry }))
  })

interface RunCustomCodeActionProps {
  args: RunCustomCodeArgs
  onChange?: (
    args: RunCustomCodeArgs,
    hasErrors: boolean,
    childDirty: boolean
  ) => void
}

export default function RunCustomCodeAction({
  args,
  onChange
}: RunCustomCodeActionProps) {
  const initialParamsRef = useRef<NormalizedParams>(normalizeParams(args))
  const [params, setParams] = useState<NormalizedParams>(
    initialParamsRef.current
  )
  const [dirty, setDirty] = useState<boolean>(Boolean(args?.dirty))
  const [childDirty, setChildDirty] = useState(false)
  const [childHasErrors, setChildHasErrors] = useState(false)

  const lastArgsSignatureRef = useRef<string>(
    serializeParams(initialParamsRef.current)
  )
  const lastArgsDirtyRef = useRef<boolean>(Boolean(args?.dirty))
  const internalUpdateRef = useRef(false)
  const lastEmittedRef = useRef<{
    params: NormalizedParams
    hasErrors: boolean
    dirty: boolean
  } | null>(null)

  useEffect(() => {
    const normalized = normalizeParams(args)
    const signature = serializeParams(normalized)
    const incomingDirty = Boolean(args?.dirty)

    if (
      signature === lastArgsSignatureRef.current &&
      incomingDirty === lastArgsDirtyRef.current
    ) {
      return
    }

    lastArgsSignatureRef.current = signature
    lastArgsDirtyRef.current = incomingDirty
    internalUpdateRef.current = true
    initialParamsRef.current = normalized
    setParams(normalized)
    setDirty(incomingDirty)
    setChildDirty(false)
    setChildHasErrors(false)
  }, [args])

  const codeHasErrors = useMemo(() => {
    try {
      if (params.code.trim()) {
        new Function(params.code)
      }
      return false
    } catch {
      return true
    }
  }, [params.code])

  const combinedDirty = dirty || childDirty
  const combinedHasErrors = codeHasErrors || childHasErrors

  useEffect(() => {
    if (!onChange) return

    if (internalUpdateRef.current) {
      internalUpdateRef.current = false
      return
    }

    const payload = cloneParams(params)
    const last = lastEmittedRef.current

    if (
      last &&
      last.dirty === combinedDirty &&
      last.hasErrors === combinedHasErrors &&
      deepEqual(last.params, payload)
    ) {
      return
    }

    lastEmittedRef.current = {
      params: payload,
      hasErrors: combinedHasErrors,
      dirty: combinedDirty
    }

    onChange(payload, combinedHasErrors, combinedDirty)
  }, [combinedDirty, combinedHasErrors, onChange, params])

  return (
    <div className="flex flex-col gap-2">
      <NodeTextAreaField
        value={params.code}
        placeholder="Enter custom JavaScript code"
        rows={6}
        onChange={(val) => {
          setParams((prev) => {
            if (prev.code === val) {
              return prev
            }
            setDirty(true)
            return { ...prev, code: val }
          })
        }}
      />
      <KeyValuePair
        title="Inputs"
        variables={params.inputs}
        onChange={(updated, nodeHasErrors, childDirtyState) => {
          const normalized = normalizePairs(updated)
          setParams((prev) => {
            if (deepEqual(prev.inputs, normalized)) {
              return prev
            }
            setDirty(true)
            return { ...prev, inputs: normalized }
          })
          setChildDirty((prev) => prev || childDirtyState)
          setChildHasErrors(nodeHasErrors)
        }}
      />
      <KeyValuePair
        title="Outputs"
        variables={params.outputs}
        onChange={(updated, nodeHasErrors, childDirtyState) => {
          const normalized = normalizePairs(updated)
          setParams((prev) => {
            if (deepEqual(prev.outputs, normalized)) {
              return prev
            }
            setDirty(true)
            return { ...prev, outputs: normalized }
          })
          setChildDirty((prev) => prev || childDirtyState)
          setChildHasErrors(nodeHasErrors)
        }}
      />
      {codeHasErrors && (
        <p className="text-xs text-red-500">Syntax error in code</p>
      )}
    </div>
  )
}

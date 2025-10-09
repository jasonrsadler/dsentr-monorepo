import { useEffect, useState } from 'react'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'

interface RunCustomCodeActionProps {
  code: string // user-entered JS/TS code
  language: 'js' | 'ts'
  inputs?: { key: string; value: string }[]
  outputs?: { key: string; value: string }[]
  dirty: boolean
  setParams: (params: Partial<RunCustomCodeActionProps>) => void
  setDirty: (dirty: boolean) => void
}

export default function RunCustomCodeAction({
  args,
  onChange
}: {
  args: RunCustomCodeActionProps
  onChange?: (
    args: Partial<RunCustomCodeActionProps>,
    hasErrors: boolean,
    childDirty: boolean
  ) => void
}) {
  const [code, setCode] = useState(args.code || '')
  const [language, setLanguage] = useState(args.language || 'js')
  const [inputs, setInputs] = useState(args.inputs || [])
  const [outputs, setOutputs] = useState(args.outputs || [])
  const [hasErrors, setHasErrors] = useState(false)
  const [, setDirty] = useState(false)

  useEffect(() => {
    let error = false
    try {
      if (code.trim()) new Function(code)
    } catch {
      error = true
    }
    setHasErrors(error)
    onChange?.({ code, language, inputs, outputs }, error, true)
  }, [code, language, inputs, outputs, onChange])

  return (
    <div className="flex flex-col gap-2">
      <NodeDropdownField
        options={['js', 'ts']}
        value={language}
        onChange={(val) => {
          setLanguage(val)
          setDirty(true)
        }}
      />
      <NodeTextAreaField
        value={code}
        placeholder="Enter custom JS/TS code"
        rows={6}
        onChange={(val) => {
          setCode(val)
          setDirty(true)
        }}
      />
      <KeyValuePair
        title="Inputs"
        variables={inputs || []}
        onChange={(updated, nodeHasErrors, childDirty) => {
          setInputs(updated)
          setDirty((prev) => prev || childDirty)
          onChange?.(
            { code, language, inputs: updated, outputs },
            nodeHasErrors,
            childDirty
          )
        }}
      />
      <KeyValuePair
        title="Outputs"
        variables={outputs}
        onChange={(updated, nodeHasErrors, childDirty) => {
          setOutputs(updated)
          setDirty((prev) => prev || childDirty)
          onChange?.(
            { code, language, inputs, outputs: updated },
            nodeHasErrors,
            childDirty
          )
        }}
      />
      {hasErrors && (
        <p className="text-xs text-red-500">Syntax error in code</p>
      )}
    </div>
  )
}

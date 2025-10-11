import { useEffect, useMemo, useState } from 'react'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'

export interface TeamsActionValues {
  webhookUrl?: string
  message?: string
}

interface TeamsActionProps {
  args: TeamsActionValues
  initialDirty?: boolean
  onChange?: (
    args: TeamsActionValues,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
}

export default function TeamsAction({
  args,
  initialDirty = false,
  onChange
}: TeamsActionProps) {
  const [params, setParams] = useState<TeamsActionValues>({ ...args })
  const [dirty, setDirty] = useState(initialDirty)

  useEffect(() => {
    const next = { ...args }
    if (
      (params.webhookUrl ?? '') !== (next.webhookUrl ?? '') ||
      (params.message ?? '') !== (next.message ?? '')
    ) {
      setParams(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args?.webhookUrl, args?.message])

  useEffect(() => {
    setDirty(initialDirty)
  }, [initialDirty])

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!params.webhookUrl?.trim())
      errors.webhookUrl = 'Webhook URL is required'
    if (!params.message?.trim()) errors.message = 'Message cannot be empty'
    return errors
  }, [params])

  useEffect(() => {
    onChange?.(params, Object.keys(validationErrors).length > 0, dirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, validationErrors, dirty])

  const updateField = (key: keyof TeamsActionValues, value: string) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="Webhook URL"
        value={params.webhookUrl || ''}
        onChange={(val) => updateField('webhookUrl', val)}
      />
      {validationErrors.webhookUrl && (
        <p className={errorClass}>{validationErrors.webhookUrl}</p>
      )}

      <NodeInputField
        placeholder="Message"
        value={params.message || ''}
        onChange={(val) => updateField('message', val)}
      />
      {validationErrors.message && (
        <p className={errorClass}>{validationErrors.message}</p>
      )}
    </div>
  )
}

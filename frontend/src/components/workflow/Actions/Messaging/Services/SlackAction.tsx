import { useEffect, useMemo, useState } from 'react'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'

export interface SlackActionValues {
  channel?: string
  message?: string
  token?: string
}

interface SlackActionProps {
  args: SlackActionValues
  initialDirty?: boolean
  onChange?: (
    args: SlackActionValues,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
}

export default function SlackAction({
  args,
  initialDirty = false,
  onChange
}: SlackActionProps) {
  const [params, setParams] = useState<SlackActionValues>({ ...args })
  const [dirty, setDirty] = useState(initialDirty)

  useEffect(() => {
    const next = { ...args }
    if (
      (params.channel ?? '') !== (next.channel ?? '') ||
      (params.message ?? '') !== (next.message ?? '') ||
      (params.token ?? '') !== (next.token ?? '')
    ) {
      setParams(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args?.channel, args?.message, args?.token])

  useEffect(() => {
    setDirty(initialDirty)
  }, [initialDirty])

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!params.channel?.trim()) errors.channel = 'Channel is required'
    if (!params.message?.trim()) errors.message = 'Message cannot be empty'
    if (!params.token?.trim()) errors.token = 'Slack token is required'
    return errors
  }, [params])

  useEffect(() => {
    onChange?.(params, Object.keys(validationErrors).length > 0, dirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, validationErrors, dirty])

  const updateField = (key: keyof SlackActionValues, value: string) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="Channel (e.g. #general)"
        value={params.channel || ''}
        onChange={(val) => updateField('channel', val)}
      />
      {validationErrors.channel && (
        <p className={errorClass}>{validationErrors.channel}</p>
      )}

      <NodeSecretDropdown
        group="messaging"
        service="slack"
        value={params.token || ''}
        onChange={(val) => updateField('token', val)}
        placeholder="Select Slack token"
      />
      {validationErrors.token && (
        <p className={errorClass}>{validationErrors.token}</p>
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

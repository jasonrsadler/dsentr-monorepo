import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import { useEffect, useMemo, useState } from 'react'

interface SlackActionProps {
  channel: string
  message: string
  token: string
  dirty: boolean
  setParams: (params: Partial<SlackActionProps>) => void
  setDirty: (dirty: boolean) => void
}

export default function SlackAction({
  args,
  onChange
}: {
  args: SlackActionProps
  onChange?: (
    args: Partial<SlackActionProps>,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
}) {
  const [_, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<SlackActionProps>>({ ...args })

  const hasErrors = (updatedParams: Partial<SlackActionProps>) => {
    const errors: Partial<SlackActionProps> = {}
    if (!updatedParams.channel?.trim()) errors.channel = 'Channel is required'
    if (!updatedParams.message?.trim())
      errors.message = 'Message cannot be empty'
    if (!updatedParams.token?.trim()) errors.token = 'Slack token is required'
    return errors
  }

  const slackErrors = useMemo(() => hasErrors(params), [params])

  useEffect(() => {
    onChange?.(params, Object.keys(slackErrors).length > 0, true)
  }, [params])

  const updateField = (key: keyof SlackActionProps, value: any) => {
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
      {slackErrors.channel && (
        <p className={errorClass}>{slackErrors.channel}</p>
      )}

      <NodeInputField
        placeholder="Token"
        type="password"
        value={params.token || ''}
        onChange={(val) => updateField('token', val)}
      />
      {slackErrors.token && <p className={errorClass}>{slackErrors.token}</p>}

      <NodeInputField
        placeholder="Message"
        value={params.message || ''}
        onChange={(val) => updateField('message', val)}
      />
      {slackErrors.message && (
        <p className={errorClass}>{slackErrors.message}</p>
      )}
    </div>
  )
}

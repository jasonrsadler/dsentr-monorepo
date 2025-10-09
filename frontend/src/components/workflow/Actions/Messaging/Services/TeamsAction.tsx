import NodeInputField from "@/components/UI/InputFields/NodeInputField"
import { useEffect, useMemo, useState } from "react"

interface TeamsActionProps {
  webhookUrl: string
  message: string
  dirty: boolean
  setParams: (params: Partial<TeamsActionProps>) => void
  setDirty: (dirty: boolean) => void
}

export default function TeamsAction({
  args,
  onChange
}: {
  args: TeamsActionProps
  onChange?: (args: Partial<TeamsActionProps>, nodeHasErrors: boolean, childDirty: boolean) => void
}) {
  const [_, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<TeamsActionProps>>({ ...args })

  const hasErrors = (updatedParams: Partial<TeamsActionProps>) => {
    const errors: Partial<TeamsActionProps> = {}
    if (!updatedParams.webhookUrl?.trim()) errors.webhookUrl = "Webhook URL is required"
    if (!updatedParams.message?.trim()) errors.message = "Message cannot be empty"
    return errors
  }

  const teamsErrors = useMemo(() => hasErrors(params), [params])

  useEffect(() => {
    onChange?.(params, Object.keys(teamsErrors).length > 0, true)
  }, [params])

  const updateField = (key: keyof TeamsActionProps, value: any) => {
    setDirty(true)
    setParams(prev => ({ ...prev, [key]: value }))
  }

  const errorClass = "text-xs text-red-500"

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="Webhook URL"
        value={params.webhookUrl || ""}
        onChange={val => updateField("webhookUrl", val)}
      />
      {teamsErrors.webhookUrl && <p className={errorClass}>{teamsErrors.webhookUrl}</p>}

      <NodeInputField
        placeholder="Message"
        value={params.message || ""}
        onChange={val => updateField("message", val)}
      />
      {teamsErrors.message && <p className={errorClass}>{teamsErrors.message}</p>}
    </div>
  )
}

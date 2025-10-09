import NodeInputField from "@/components/UI/InputFields/NodeInputField"
import { useEffect, useMemo, useState } from "react"

interface GoogleChatActionProps {
  webhookUrl: string
  message: string
  dirty: boolean
  setParams: (params: Partial<GoogleChatActionProps>) => void
  setDirty: (dirty: boolean) => void
}

export default function GoogleChatAction({
  args,
  onChange
}: {
  args: GoogleChatActionProps
  onChange?: (args: Partial<GoogleChatActionProps>, nodeHasErrors: boolean, childDirty: boolean) => void
}) {
  const [_, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<GoogleChatActionProps>>({ ...args })

  const hasErrors = (updatedParams: Partial<GoogleChatActionProps>) => {
    const errors: Partial<GoogleChatActionProps> = {}
    if (!updatedParams.webhookUrl?.trim()) errors.webhookUrl = "Webhook URL is required"
    if (!updatedParams.message?.trim()) errors.message = "Message cannot be empty"
    return errors
  }

  const chatErrors = useMemo(() => hasErrors(params), [params])

  useEffect(() => {
    onChange?.(params, Object.keys(chatErrors).length > 0, true)
  }, [params])

  const updateField = (key: keyof GoogleChatActionProps, value: any) => {
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
      {chatErrors.webhookUrl && <p className={errorClass}>{chatErrors.webhookUrl}</p>}

      <NodeInputField
        placeholder="Message"
        value={params.message || ""}
        onChange={val => updateField("message", val)}
      />
      {chatErrors.message && <p className={errorClass}>{chatErrors.message}</p>}
    </div>
  )
}

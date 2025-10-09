import { useState, useEffect, useMemo } from "react"
import NodeDropdownField from "@/components/UI/InputFields/NodeDropdownField"
import SlackAction from "./Services/SlackAction"
import TeamsAction from "./Services/TeamsAction"
import GoogleChatAction from "./Services/GoogleChatAction"

interface MessagingActionProps {
  args: any
  onChange?: (args: any, nodeHasErrors: boolean, childDirty: boolean) => void
}

export default function MessagingAction({ args, onChange }: MessagingActionProps) {
  const [params, setParams] = useState({
    ...args,
    platform: args?.platform || "Slack"
  })
  const [childParams, setChildParams] = useState(args || {})
  const [childHasErrors, setChildHasErrors] = useState(false)
  const [childDirty, setChildDirty] = useState(false)

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!params.platform) errors.platform = "Platform is required"
    return errors
  }, [params])

  useEffect(() => {
    onChange?.(
      { ...childParams, platform: params.platform },
      childHasErrors || Object.keys(validationErrors).length > 0,
      childDirty
    )
  }, [params, childParams, childHasErrors, childDirty])

  const updateField = (key: string, value: any) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  const handleChildChange = (updated: any, hasErrors: boolean, isDirty: boolean) => {
    setChildParams(updated)
    setChildHasErrors(hasErrors)
    setChildDirty(isDirty)
  }

  const errorClass = "text-xs text-red-500"

  return (
    <div className="flex flex-col gap-3">
      <NodeDropdownField
        options={["Slack", "Teams", "Google Chat"]}
        value={params.platform}
        onChange={val => updateField("platform", val)}
      />
      {validationErrors.platform && <p className={errorClass}>{validationErrors.platform}</p>}

      {params.platform === "Slack" && (
        <SlackAction args={childParams} onChange={handleChildChange} />
      )}
      {params.platform === "Teams" && (
        <TeamsAction args={childParams} onChange={handleChildChange} />
      )}
      {params.platform === "Google Chat" && (
        <GoogleChatAction args={childParams} onChange={handleChildChange} />
      )}
    </div>
  )
}

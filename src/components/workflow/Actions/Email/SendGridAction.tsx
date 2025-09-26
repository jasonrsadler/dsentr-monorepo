import { useEffect, useMemo, useState } from "react"
import KeyValuePair from "@/components/UI/ReactFlow/KeyValuePair"
import NodeInputField from "@/components/UI/InputFields/NodeInputField"

interface SendGridActionProps {
  apiKey: string
  from: string
  to: string
  templateId?: string
  substitutions?: { key: string; value: string }[]
  subject: string
  body: string
  dirty: boolean
  setParams: (params: Partial<SendGridActionProps>) => void
  setDirty: (dirty: boolean) => void
}

export default function SendGridAction({ args, onChange }: { args: SendGridActionProps, onChange?: (args: Partial<SendGridActionProps>, hasErrors: boolean, dirty: boolean) => void }) {
  const inputClass = "text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-zinc-500 nodrag"

  const [_, setDirty] = useState(false)
  const [params, setParams] = useState({
    ...args
  })

  useEffect(() => {
    onChange?.(params, Object.keys(hasErrors(params)).length > 0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const hasErrors = (updatedParams: Partial<SendGridActionProps>) => {
    const errors: Partial<SendGridActionProps> = {}
    if (!updatedParams.apiKey?.trim()) errors.apiKey = "API key is required"
    if (!updatedParams.from?.trim()) errors.from = "From email is required"

    if (!updatedParams.to?.trim()) {
      errors.to = "Recipient email(s) required"
    } else {
      const recipients = updatedParams.to.split(",").map(r => r.trim()).filter(Boolean)
      const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (recipients.length === 0) errors.to = "Recipient email(s) required"
      else if (recipients.some(r => !emailRx.test(r))) errors.to = "One or more recipient emails are invalid"
      else if (new Set(recipients).size !== recipients.length) errors.to = "Duplicate recipient emails are not allowed"
    }

    if (!updatedParams.templateId?.trim()) {
      if (!updatedParams.subject?.trim()) errors.subject = "Subject is required"
      if (!updatedParams.body?.trim()) errors.body = "Message body is required"
    }

    return errors
  }

  const sendGridErrors = useMemo(() => hasErrors(params), [params])

  const updateField = (key: string, value: string) => {
    setDirty(true)
    setParams(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="SendGrid API Key"
        className={inputClass}
        value={params.apiKey}
        onChange={val => updateField("apiKey", val)}
        type="password"
      />
      {sendGridErrors.apiKey && <p className="text-xs text-red-500">{sendGridErrors.apiKey}</p>}

      <input
        type="email"
        placeholder="From Email"
        className={inputClass}
        value={params.from}
        onChange={e => updateField("from", e.target.value)}
      />
      {sendGridErrors.from && <p className="text-xs text-red-500">{sendGridErrors.from}</p>}

      <input
        type="text"
        placeholder="Template ID (optional)"
        className={inputClass}
        value={params.templateId}
        onChange={e => updateField("templateId", e.target.value)}
      />

      {params.templateId && (
        <KeyValuePair
          title="Substitution Variables"
          variables={params.substitutions}
          onChange={(updatedVars, nodeHasErrors, childDirty) => {
            setParams(prev => ({ ...prev, substitutions: updatedVars }))
            setDirty(prev => prev || childDirty)
            onChange?.({ ...params, substitutions: updatedVars }, nodeHasErrors, childDirty)
          }}
        />
      )}

      <input
        type="email"
        placeholder="Recipient Email(s)"
        className={inputClass}
        value={params.to}
        onChange={e => updateField("to", e.target.value)}
      />
      {sendGridErrors.to && <p className="text-xs text-red-500">{sendGridErrors.to}</p>}

      {!params.templateId && (
        <>
          <input
            placeholder="Subject"
            className={inputClass}
            value={params.subject}
            onChange={e => updateField("subject", e.target.value)}
          />
          {sendGridErrors.subject && <p className="text-xs text-red-500">{sendGridErrors.subject}</p>}

          <textarea
            placeholder="Message Body"
            className={inputClass}
            value={params.body}
            onChange={e => updateField("body", e.target.value)}
          />
          {sendGridErrors.body && <p className="text-xs text-red-500">{sendGridErrors.body}</p>}
        </>
      )}
    </div>
  )
}

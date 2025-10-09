import NodeCheckBoxField from '@/components/UI/InputFields/NodeCheckboxField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import { useEffect, useMemo, useState } from 'react'

interface SMTPActionProps {
  smtpHost: string
  smtpPort: number | string
  smtpUser: string
  smtpPassword: string
  smtpTls: boolean
  from: string
  to: string
  subject: string
  body: string
  dirty: boolean
  setParams: (params: Partial<SMTPActionProps>) => void
  setDirty: (dirty: boolean) => void
}

export default function SMTPAction({
  args,
  onChange
}: {
  args: SMTPActionProps
  onChange?: (
    args: Partial<SMTPActionProps>,
    hasErrors: boolean,
    dirty: boolean
  ) => void
}) {
  const [_, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<SMTPActionProps>>({
    ...args,
    smtpPort: 587,
    smtpTls: true
  })
  useEffect(() => {
    onChange?.(params, Object.keys(hasErrors(params)).length > 0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const hasErrors = (updatedParams: Partial<SMTPActionProps>) => {
    const errors: Partial<SMTPActionProps> = {}
    if (!updatedParams.smtpHost?.trim())
      errors.smtpHost = 'SMTP Host is required'
    const port = Number(updatedParams.smtpPort)
    if (!updatedParams.smtpPort || Number.isNaN(port) || port <= 0)
      errors.smtpPort = 'Valid SMTP Port is required'
    if (!updatedParams.smtpUser?.trim())
      errors.smtpUser = 'SMTP User is required'
    if (!updatedParams.smtpPassword?.trim())
      errors.smtpPassword = 'SMTP Password is required'
    if (!updatedParams.from?.trim()) errors.from = 'From email is required'
    if (!updatedParams.to?.trim()) {
      errors.to = 'Recipient email(s) required'
    } else {
      const recipients = updatedParams.to
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
      const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (recipients.length === 0) errors.to = 'Recipient email(s) required'
      else if (recipients.some((r) => !emailRx.test(r)))
        errors.to = 'One or more recipient emails are invalid'
      else if (new Set(recipients).size !== recipients.length)
        errors.to = 'Duplicate recipient emails are not allowed'
    }
    if (!updatedParams.subject?.trim()) errors.subject = 'Subject is required'
    if (!updatedParams.body?.trim()) errors.body = 'Message body is required'
    return errors
  }
  const smtpErrors = useMemo(() => hasErrors(params), [params])

  const updateField = (key: keyof SMTPActionProps, value: any) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="SMTP Host"
        value={params.smtpHost || ''}
        onChange={(val) => updateField('smtpHost', val)}
      />
      {smtpErrors.smtpHost && (
        <p className={errorClass}>{smtpErrors.smtpHost}</p>
      )}
      <NodeInputField
        placeholder="SMTP Port"
        type="number"
        value={params.smtpPort?.toString() || ''}
        onChange={(val) => updateField('smtpPort', Number(val))}
      />
      {smtpErrors.smtpPort && (
        <p className={errorClass}>{smtpErrors.smtpPort}</p>
      )}
      <NodeInputField
        placeholder="Username"
        value={params.smtpUser || ''}
        onChange={(val) => updateField('smtpUser', val)}
      />
      {smtpErrors.smtpUser && (
        <p className={errorClass}>{smtpErrors.smtpUser}</p>
      )}
      <NodeInputField
        type="password"
        placeholder="API Key / Password"
        value={params.smtpPassword || ''}
        onChange={(val) => updateField('smtpPassword', val)}
      />
      {smtpErrors.smtpPassword && (
        <p className={errorClass}>{smtpErrors.smtpPassword}</p>
      )}
      <NodeCheckBoxField
        checked={params.smtpTls ?? true}
        onChange={(val) => {
          const checked = Boolean(val)
          setParams((prev) => ({
            ...prev,
            smtpTls: checked,
            smtpPort:
              prev.smtpPort === 25 || prev.smtpPort === 587
                ? checked
                  ? 587
                  : 25
                : prev.smtpPort
          }))
          setDirty(true)
        }}
      >
        Use TLS
      </NodeCheckBoxField>
      <NodeInputField
        type="email"
        placeholder="Sender Email"
        value={params.from || ''}
        onChange={(val) => updateField('from', val)}
      />
      {smtpErrors.from && <p className={errorClass}>{smtpErrors.from}</p>}
      <NodeInputField
        placeholder="Recipient Email(s)"
        value={params.to || ''}
        onChange={(val) => updateField('to', val)}
      />
      {smtpErrors.to && <p className={errorClass}>{smtpErrors.to}</p>}
      <NodeInputField
        placeholder="Subject"
        value={params.subject || ''}
        onChange={(val) => updateField('subject', val)}
      />
      {smtpErrors.subject && <p className={errorClass}>{smtpErrors.subject}</p>}
      <NodeTextAreaField
        placeholder="Message Body"
        value={params.body || ''}
        onChange={(val) => updateField('body', val)}
      />
      {smtpErrors.body && <p className={errorClass}>{smtpErrors.body}</p>}
    </div>
  )
}

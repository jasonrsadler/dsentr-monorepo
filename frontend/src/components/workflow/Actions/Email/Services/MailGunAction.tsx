import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import { useEffect, useMemo, useState } from 'react'
import MailgunRegionDropdown from '../ServiceDropDowns/MailgunRegionDropdown'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'

interface MailGunActionProps {
  domain: string
  apiKey: string
  region: string
  from: string
  to: string
  subject: string
  body: string
  template?: string
  variables?: { key: string; value: string }[]
  dirty: boolean
  setParams: (params: Partial<MailGunActionProps>) => void
  setDirty: (dirty: boolean) => void
}

export default function MailGunAction({
  args,
  onChange
}: {
  args: MailGunActionProps
  onChange?: (
    args: Partial<MailGunActionProps>,
    hasErrors: boolean,
    dirty: boolean
  ) => void
}) {
  const [_, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<MailGunActionProps>>({
    ...args
  })
  useEffect(() => {
    onChange?.(params, Object.keys(hasErrors(params)).length > 0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const hasErrors = (updatedParams: Partial<MailGunActionProps>) => {
    const errors: Partial<MailGunActionProps> = {}
    if (!updatedParams.domain?.trim()) errors.domain = 'Domain is required'
    if (!updatedParams.apiKey?.trim()) errors.apiKey = 'API key is required'
    if (!updatedParams.region?.trim()) errors.region = 'Region is required'
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
    if (!updatedParams.template?.trim()) {
      if (!updatedParams.subject?.trim()) errors.subject = 'Subject is required'
      if (!updatedParams.body?.trim()) errors.body = 'Message body is required'
    }
    return errors
  }

  const mailGunErrors = useMemo(() => hasErrors(params), [params])

  const updateField = (key: keyof MailGunActionProps, value: any) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <>
      <div className="space-y-2">
        <NodeInputField
          placeholder="Domain (e.g. mg.example.com)"
          value={params.domain || ''}
          onChange={(val) => updateField('domain', val)}
        />
        {mailGunErrors.domain && (
          <p className={errorClass}>{mailGunErrors.domain}</p>
        )}

        <NodeSecretDropdown
          group="email"
          service="mailgun"
          value={params.apiKey || ''}
          onChange={(val) => updateField('apiKey', val)}
          placeholder="Select Mailgun API key"
        />
        {mailGunErrors.apiKey && (
          <p className={errorClass}>{mailGunErrors.apiKey}</p>
        )}

        <MailgunRegionDropdown
          value={params.region || ''}
          onChange={(val: string) => updateField('region', val)}
        />
        {mailGunErrors.region && (
          <p className={errorClass}>{mailGunErrors.region}</p>
        )}
        <NodeInputField
          type="email"
          placeholder="From"
          value={params.from || ''}
          onChange={(val) => updateField('from', val)}
        />
        {mailGunErrors.from && (
          <p className={errorClass}>{mailGunErrors.from}</p>
        )}

        <NodeInputField
          type="email"
          placeholder="To (comma separated)"
          value={params.to || ''}
          onChange={(val) => updateField('to', val)}
        />
        {mailGunErrors.to && <p className={errorClass}>{mailGunErrors.to}</p>}

        <NodeInputField
          placeholder="Template Name (optional)"
          value={params.template || ''}
          onChange={(val) => updateField('template', val)}
        />

        {params.template?.trim() && (
          <KeyValuePair
            title="Template Variables"
            variables={params.variables || []}
            onChange={(updatedVars, nodeHasErrors, childDirty) => {
              setParams((prev) => ({ ...prev, variables: updatedVars }))
              setDirty((prev) => prev || childDirty)
              onChange?.(
                { ...params, variables: updatedVars },
                nodeHasErrors,
                childDirty
              )
            }}
          />
        )}
        {!params.template && (
          <>
            <NodeInputField
              placeholder="Subject"
              value={params.subject || ''}
              onChange={(val) => updateField('subject', val)}
            />
            {mailGunErrors.subject && (
              <p className={errorClass}>{mailGunErrors.subject}</p>
            )}
            <NodeTextAreaField
              placeholder="Body (plain text or HTML)"
              value={params.body || ''}
              rows={4}
              onChange={(val) => updateField('body', val)}
            />
            {mailGunErrors.body && (
              <p className={errorClass}>{mailGunErrors.body}</p>
            )}
          </>
        )}
      </div>
    </>
  )
}

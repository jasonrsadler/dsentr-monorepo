import NodeInputField from '@/components/ui/input-fields/NodeInputField'
import NodeSecretDropdown from '@/components/ui/input-fields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/ui/input-fields/NodeTextAreaField'
import KeyValuePair from '@/components/ui/react-flow/KeyValuePair'
import { useEffect, useMemo, useRef, useState } from 'react'
import SESRegionDropdown from '../ServiceDropDowns/SESRegionDropdown'
import SESVersionDropdown from '../ServiceDropDowns/SESVersionDropdown'

interface AmazonSESActionProps {
  awsAccessKey: string
  awsSecretKey: string
  awsRegion: string
  sesVersion: string
  fromEmail: string
  toEmail: string
  subject: string
  body: string
  template?: string
  templateVariables?: { key: string; value: string }[]
}

export default function AmazonSESAction({
  args,
  onChange
}: {
  args: AmazonSESActionProps
  onChange?: (
    args: Partial<AmazonSESActionProps>,
    hasErrors: boolean,
    dirty: boolean
  ) => void
}) {
  const [_, setDirty] = useState(false)
  const [templateVarsHaveErrors, setTemplateVarsHaveErrors] = useState(false)
  const [params, setParams] = useState<Partial<AmazonSESActionProps>>(() => ({
    ...args,
    sesVersion: args.sesVersion || 'v2'
  }))
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!params.template?.trim() && templateVarsHaveErrors) {
      setTemplateVarsHaveErrors(false)
    }
  }, [params.template, templateVarsHaveErrors])

  useEffect(() => {
    const computedErrors = hasErrors(params)
    const hasAnyErrors =
      templateVarsHaveErrors || Object.keys(computedErrors).length > 0
    onChangeRef.current?.(params, hasAnyErrors, true)
  }, [params, templateVarsHaveErrors])

  const hasErrors = (updatedParams: Partial<AmazonSESActionProps>) => {
    const errors: Partial<AmazonSESActionProps> = {}
    if (!updatedParams.awsAccessKey?.trim())
      errors.awsAccessKey = 'Access Key is required'
    if (!updatedParams.awsSecretKey?.trim())
      errors.awsSecretKey = 'Secret Key is required'
    if (!updatedParams.sesVersion?.trim())
      errors.sesVersion = 'SES version is required'
    if (!updatedParams.awsRegion?.trim())
      errors.awsRegion = 'Region is required'
    if (!updatedParams.fromEmail?.trim())
      errors.fromEmail = 'From email is required'
    if (!updatedParams.toEmail?.trim()) {
      errors.toEmail = 'Recipient email(s) required'
    } else {
      const recipients = updatedParams.toEmail
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
      const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (recipients.length === 0)
        errors.toEmail = 'Recipient email(s) required'
      else if (recipients.some((r) => !emailRx.test(r)))
        errors.toEmail = 'One or more recipient emails are invalid'
      else if (new Set(recipients).size !== recipients.length)
        errors.toEmail = 'Duplicate recipient emails are not allowed'
    }
    if (!updatedParams.template?.trim()) {
      if (!updatedParams.subject?.trim()) errors.subject = 'Subject is required'
      if (!updatedParams.body?.trim()) errors.body = 'Message body is required'
    }
    return errors
  }

  const amazonSESErrors = useMemo(() => hasErrors(params), [params])

  const updateField = (key: keyof AmazonSESActionProps, value: any) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">Amazon SES Settings</p>
      <NodeInputField
        placeholder="AWS Access Key ID"
        value={params.awsAccessKey || ''}
        onChange={(val) => updateField('awsAccessKey', val)}
      />
      {amazonSESErrors.awsAccessKey && (
        <p className={errorClass}>{amazonSESErrors.awsAccessKey}</p>
      )}
      <NodeSecretDropdown
        group="email"
        service="amazon_ses"
        value={params.awsSecretKey || ''}
        onChange={(val) => updateField('awsSecretKey', val)}
        placeholder="Select AWS secret access key"
      />
      {amazonSESErrors.awsSecretKey && (
        <p className={errorClass}>{amazonSESErrors.awsSecretKey}</p>
      )}
      <SESVersionDropdown
        value={params.sesVersion || ''}
        onChange={(val: string) => updateField('sesVersion', val)}
      />
      {amazonSESErrors.sesVersion && (
        <p className={errorClass}>{amazonSESErrors.sesVersion}</p>
      )}
      <SESRegionDropdown
        value={params.awsRegion || ''}
        onChange={(val: string) => updateField('awsRegion', val)}
      />
      {amazonSESErrors.awsRegion && (
        <p className={errorClass}>{amazonSESErrors.awsRegion}</p>
      )}
      <NodeInputField
        placeholder="From"
        value={params.fromEmail || ''}
        onChange={(val) => updateField('fromEmail', val)}
      />
      {amazonSESErrors.fromEmail && (
        <p className={errorClass}>{amazonSESErrors.fromEmail}</p>
      )}
      <NodeInputField
        placeholder="To (comma separated)"
        value={params.toEmail || ''}
        onChange={(val) => updateField('toEmail', val)}
      />
      {amazonSESErrors.toEmail && (
        <p className={errorClass}>{amazonSESErrors.toEmail}</p>
      )}
      <NodeInputField
        placeholder="Template Name (optional)"
        value={params.template || ''}
        onChange={(val) => updateField('template', val)}
      />

      {params.template?.trim() && (
        <KeyValuePair
          title="Template Variables"
          variables={params.templateVariables || []}
          onChange={(updatedVars, nodeHasErrors, childDirty) => {
            setTemplateVarsHaveErrors(nodeHasErrors)
            setParams((prev) => ({ ...prev, templateVariables: updatedVars }))
            setDirty((prev) => prev || childDirty)
          }}
        />
      )}
      {!params.template?.trim() && (
        <>
          <NodeInputField
            placeholder="Subject"
            value={params.subject || ''}
            onChange={(val) => updateField('subject', val)}
          />
          {amazonSESErrors.subject && (
            <p className={errorClass}>{amazonSESErrors.subject}</p>
          )}
          <NodeTextAreaField
            placeholder="Body (plain text or HTML)"
            value={params.body || ''}
            rows={4}
            onChange={(val) => updateField('body', val)}
          />
          {amazonSESErrors.body && (
            <p className={errorClass}>{amazonSESErrors.body}</p>
          )}
        </>
      )}
    </div>
  )
}

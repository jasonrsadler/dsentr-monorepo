import { useCallback, useEffect, useState } from 'react'

import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import MailgunRegionDropdown from '../ServiceDropDowns/MailgunRegionDropdown'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

interface MailgunVariable {
  key: string
  value: string
}

interface MailgunParams {
  service?: string
  domain?: string
  apiKey?: string
  region?: string
  from?: string
  to?: string
  subject?: string
  body?: string
  template?: string
  variables?: MailgunVariable[]
  dirty: boolean
}

interface NormalizedMailgunState {
  service?: string
  domain: string
  apiKey: string
  region: string
  from: string
  to: string
  subject: string
  body: string
  template: string
  variables: MailgunVariable[]
}

interface MailGunActionProps {
  nodeId: string
  canEdit?: boolean
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeVariables(value: unknown): MailgunVariable[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return { key: '', value: '' }
    }
    const record = entry as Record<string, unknown>
    const key = typeof record.key === 'string' ? record.key : ''
    const val = typeof record.value === 'string' ? record.value : ''
    return { key, value: val }
  })
}

function normalizeParams(
  params: MailgunParams | undefined
): NormalizedMailgunState {
  const record =
    params && typeof params === 'object' ? params : ({} as MailgunParams)
  return {
    service: typeof record.service === 'string' ? record.service : undefined,
    domain: typeof record.domain === 'string' ? record.domain : '',
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    region: typeof record.region === 'string' ? record.region : '',
    from: typeof record.from === 'string' ? record.from : '',
    to: typeof record.to === 'string' ? record.to : '',
    subject: typeof record.subject === 'string' ? record.subject : '',
    body: typeof record.body === 'string' ? record.body : '',
    template: typeof record.template === 'string' ? record.template : '',
    variables: normalizeVariables(record.variables)
  }
}

type MailgunErrors = Partial<Record<keyof NormalizedMailgunState, string>>

function validateMailgun(values: NormalizedMailgunState): MailgunErrors {
  const errors: MailgunErrors = {}
  if (!values.domain.trim()) errors.domain = 'Domain is required'
  if (!values.apiKey.trim()) errors.apiKey = 'API key is required'
  if (!values.region.trim()) errors.region = 'Region is required'
  if (!values.from.trim()) errors.from = 'From email is required'
  if (!values.to.trim()) {
    errors.to = 'Recipient email(s) required'
  } else {
    const recipients = values.to
      .split(',')
      .map((recipient) => recipient.trim())
      .filter(Boolean)
    if (recipients.length === 0) {
      errors.to = 'Recipient email(s) required'
    } else if (recipients.some((recipient) => !EMAIL_RX.test(recipient))) {
      errors.to = 'One or more recipient emails are invalid'
    } else if (new Set(recipients).size !== recipients.length) {
      errors.to = 'Duplicate recipient emails are not allowed'
    }
  }
  if (!values.template.trim()) {
    if (!values.subject.trim()) errors.subject = 'Subject is required'
    if (!values.body.trim()) errors.body = 'Message body is required'
  }
  return errors
}

export default function MailGunAction({
  nodeId,
  canEdit = true
}: MailGunActionProps) {
  const params = useActionParams<MailgunParams>(nodeId, 'email')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit
  const [variableErrors, setVariableErrors] = useState(false)
  const normalizedParams = normalizeParams(params)

  useEffect(() => {
    if (!normalizedParams.template.trim() && variableErrors) {
      setVariableErrors(false)
    }
  }, [normalizedParams.template, variableErrors])

  const emitPatch = useCallback(
    (patch: Partial<MailgunParams>) => {
      if (!effectiveCanEdit) return

      const base: MailgunParams =
        params && typeof params === 'object' ? params : ({} as MailgunParams)
      const { dirty: _dirty, ...rest } = base

      updateNodeData(nodeId, {
        params: { ...rest, ...patch },
        dirty: true
      })
    },
    [effectiveCanEdit, nodeId, params, updateNodeData]
  )

  const errors = validateMailgun(normalizedParams)

  const hasValidationErrors = (() => {
    if (Object.keys(errors).length > 0) return true
    if (variableErrors && normalizedParams.template.trim()) return true
    return false
  })()

  useEffect(() => {
    updateNodeData(nodeId, { hasValidationErrors })
  }, [hasValidationErrors, nodeId, updateNodeData])

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="space-y-2">
      <NodeInputField
        placeholder="Domain (e.g. mg.example.com)"
        value={normalizedParams.domain}
        onChange={(val) => emitPatch({ domain: val })}
      />
      {errors.domain && <p className={errorClass}>{errors.domain}</p>}

      <NodeSecretDropdown
        group="email"
        service="mailgun"
        value={normalizedParams.apiKey}
        onChange={(val) => emitPatch({ apiKey: val })}
        placeholder="Select Mailgun API key"
      />
      {errors.apiKey && <p className={errorClass}>{errors.apiKey}</p>}

      <MailgunRegionDropdown
        value={normalizedParams.region}
        onChange={(val: string) => emitPatch({ region: val })}
      />
      {errors.region && <p className={errorClass}>{errors.region}</p>}

      <NodeInputField
        type="email"
        placeholder="From"
        value={normalizedParams.from}
        onChange={(val) => emitPatch({ from: val })}
      />
      {errors.from && <p className={errorClass}>{errors.from}</p>}

      <NodeInputField
        type="email"
        placeholder="To (comma separated)"
        value={normalizedParams.to}
        onChange={(val) => emitPatch({ to: val })}
      />
      {errors.to && <p className={errorClass}>{errors.to}</p>}

      <NodeInputField
        placeholder="Template Name (optional)"
        value={normalizedParams.template}
        onChange={(val) => emitPatch({ template: val })}
      />

      {normalizedParams.template.trim() ? (
        <KeyValuePair
          title="Template Variables"
          variables={normalizedParams.variables}
          onChange={(updatedVars, nodeHasErrors) => {
            setVariableErrors(nodeHasErrors)
            emitPatch({ variables: updatedVars })
          }}
        />
      ) : (
        <>
          <NodeInputField
            placeholder="Subject"
            value={normalizedParams.subject}
            onChange={(val) => emitPatch({ subject: val })}
          />
          {errors.subject && <p className={errorClass}>{errors.subject}</p>}
          <NodeTextAreaField
            placeholder="Body (plain text or HTML)"
            value={normalizedParams.body}
            rows={4}
            onChange={(val) => emitPatch({ body: val })}
          />
          {errors.body && <p className={errorClass}>{errors.body}</p>}
        </>
      )}
    </div>
  )
}

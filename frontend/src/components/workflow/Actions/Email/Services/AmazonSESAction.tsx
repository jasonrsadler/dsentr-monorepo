import { useCallback, useEffect, useState } from 'react'

import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import SESRegionDropdown from '../ServiceDropDowns/SESRegionDropdown'
import SESVersionDropdown from '../ServiceDropDowns/SESVersionDropdown'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

interface TemplateVariable {
  key: string
  value: string
}

interface AmazonSESParams {
  service?: string
  awsAccessKey?: string
  awsSecretKey?: string
  awsRegion?: string
  sesVersion?: string
  fromEmail?: string
  toEmail?: string
  subject?: string
  body?: string
  template?: string
  templateVariables?: TemplateVariable[]
  dirty: boolean
}

interface NormalizedSESState {
  service?: string
  awsAccessKey: string
  awsSecretKey: string
  awsRegion: string
  sesVersion: string
  fromEmail: string
  toEmail: string
  subject: string
  body: string
  template: string
  templateVariables: TemplateVariable[]
}

interface AmazonSESActionProps {
  nodeId: string
  canEdit?: boolean
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeTemplateVariables(value: unknown): TemplateVariable[] {
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
  params: AmazonSESParams | undefined
): NormalizedSESState {
  const record =
    params && typeof params === 'object' ? params : ({} as AmazonSESParams)
  const template = typeof record.template === 'string' ? record.template : ''
  return {
    service: typeof record.service === 'string' ? record.service : undefined,
    awsAccessKey:
      typeof record.awsAccessKey === 'string' ? record.awsAccessKey : '',
    awsSecretKey:
      typeof record.awsSecretKey === 'string' ? record.awsSecretKey : '',
    awsRegion: typeof record.awsRegion === 'string' ? record.awsRegion : '',
    sesVersion: typeof record.sesVersion === 'string' ? record.sesVersion : '',
    fromEmail: typeof record.fromEmail === 'string' ? record.fromEmail : '',
    toEmail: typeof record.toEmail === 'string' ? record.toEmail : '',
    subject: typeof record.subject === 'string' ? record.subject : '',
    body: typeof record.body === 'string' ? record.body : '',
    template,
    templateVariables: normalizeTemplateVariables(record.templateVariables)
  }
}

type SESErrors = Partial<Record<keyof NormalizedSESState, string>>

function validate(values: NormalizedSESState): SESErrors {
  const errors: SESErrors = {}
  if (!values.awsAccessKey.trim()) {
    errors.awsAccessKey = 'Access Key is required'
  }
  if (!values.awsSecretKey.trim()) {
    errors.awsSecretKey = 'Secret Key is required'
  }
  if (!values.sesVersion.trim()) {
    errors.sesVersion = 'SES version is required'
  }
  if (!values.awsRegion.trim()) {
    errors.awsRegion = 'Region is required'
  }
  if (!values.fromEmail.trim()) {
    errors.fromEmail = 'From email is required'
  }
  if (!values.toEmail.trim()) {
    errors.toEmail = 'Recipient email(s) required'
  } else {
    const recipients = values.toEmail
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (recipients.length === 0) {
      errors.toEmail = 'Recipient email(s) required'
    } else if (recipients.some((recipient) => !EMAIL_RX.test(recipient))) {
      errors.toEmail = 'One or more recipient emails are invalid'
    } else if (new Set(recipients).size !== recipients.length) {
      errors.toEmail = 'Duplicate recipient emails are not allowed'
    }
  }
  if (!values.template.trim()) {
    if (!values.subject.trim()) errors.subject = 'Subject is required'
    if (!values.body.trim()) errors.body = 'Message body is required'
  }
  return errors
}

export default function AmazonSESAction({
  nodeId,
  canEdit = true
}: AmazonSESActionProps) {
  const params = useActionParams<AmazonSESParams>(nodeId, 'email')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit
  const [templateErrors, setTemplateErrors] = useState(false)
  const normalizedParams = normalizeParams(params)

  useEffect(() => {
    if (!normalizedParams.template.trim() && templateErrors) {
      setTemplateErrors(false)
    }
  }, [normalizedParams.template, templateErrors])

  const emitPatch = useCallback(
    (patch: Partial<AmazonSESParams>) => {
      if (!effectiveCanEdit) return

      const base: AmazonSESParams =
        params && typeof params === 'object' ? params : ({} as AmazonSESParams)
      const { dirty: _dirty, ...rest } = base

      updateNodeData(nodeId, {
        params: { ...rest, ...patch },
        dirty: true
      })
    },
    [effectiveCanEdit, nodeId, params, updateNodeData]
  )

  const errors = validate(normalizedParams)

  const hasValidationErrors = (() => {
    if (Object.keys(errors).length > 0) return true
    if (templateErrors && normalizedParams.template.trim()) return true
    return false
  })()

  useEffect(() => {
    updateNodeData(nodeId, { hasValidationErrors })
  }, [hasValidationErrors, nodeId, updateNodeData])

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">Amazon SES Settings</p>
      <NodeInputField
        placeholder="AWS Access Key ID"
        value={normalizedParams.awsAccessKey}
        onChange={(val) => emitPatch({ awsAccessKey: val })}
      />
      {errors.awsAccessKey && (
        <p className={errorClass}>{errors.awsAccessKey}</p>
      )}
      <NodeSecretDropdown
        group="email"
        service="amazon_ses"
        value={normalizedParams.awsSecretKey}
        onChange={(val) => emitPatch({ awsSecretKey: val })}
        placeholder="Select AWS secret access key"
      />
      {errors.awsSecretKey && (
        <p className={errorClass}>{errors.awsSecretKey}</p>
      )}
      <SESVersionDropdown
        value={normalizedParams.sesVersion}
        onChange={(val: string) => emitPatch({ sesVersion: val })}
      />
      {errors.sesVersion && <p className={errorClass}>{errors.sesVersion}</p>}
      <SESRegionDropdown
        value={normalizedParams.awsRegion}
        onChange={(val: string) => emitPatch({ awsRegion: val })}
      />
      {errors.awsRegion && <p className={errorClass}>{errors.awsRegion}</p>}
      <NodeInputField
        placeholder="From"
        value={normalizedParams.fromEmail}
        onChange={(val) => emitPatch({ fromEmail: val })}
      />
      {errors.fromEmail && <p className={errorClass}>{errors.fromEmail}</p>}
      <NodeInputField
        placeholder="To (comma separated)"
        value={normalizedParams.toEmail}
        onChange={(val) => emitPatch({ toEmail: val })}
      />
      {errors.toEmail && <p className={errorClass}>{errors.toEmail}</p>}
      <NodeInputField
        placeholder="Template Name (optional)"
        value={normalizedParams.template}
        onChange={(val) => emitPatch({ template: val })}
      />

      {normalizedParams.template.trim() ? (
        <KeyValuePair
          title="Template Variables"
          variables={normalizedParams.templateVariables}
          onChange={(updatedVars, nodeHasErrors) => {
            setTemplateErrors(nodeHasErrors)
            emitPatch({ templateVariables: updatedVars })
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

import { useCallback, useEffect, useState } from 'react'

import KeyValuePair from '@/components/ui/ReactFlow/KeyValuePair'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/ui/InputFields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/ui/InputFields/NodeTextAreaField'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

type SendGridSubstitution = { key: string; value: string }

interface SendGridParams {
  service?: string
  apiKey?: string
  from?: string
  to?: string
  templateId?: string
  substitutions?: SendGridSubstitution[]
  subject?: string
  body?: string
  dirty: boolean
}

interface NormalizedSendGridState {
  service?: string
  apiKey: string
  from: string
  to: string
  templateId: string
  substitutions: SendGridSubstitution[]
  subject: string
  body: string
}

interface SendGridActionProps {
  nodeId: string
  canEdit?: boolean
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeSubstitutions(value: unknown): SendGridSubstitution[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return { key: '', value: '' }
    }
    const record = entry as Record<string, unknown>
    const key = typeof record.key === 'string' ? record.key : ''
    const valueStr = typeof record.value === 'string' ? record.value : ''
    return { key, value: valueStr }
  })
}

function normalizeParams(
  params: Partial<SendGridParams> | undefined
): NormalizedSendGridState {
  const record =
    params && typeof params === 'object'
      ? params
      : ({} as Partial<SendGridParams>)
  return {
    service: typeof record.service === 'string' ? record.service : undefined,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    from: typeof record.from === 'string' ? record.from : '',
    to: typeof record.to === 'string' ? record.to : '',
    templateId: typeof record.templateId === 'string' ? record.templateId : '',
    substitutions: normalizeSubstitutions(record.substitutions),
    subject: typeof record.subject === 'string' ? record.subject : '',
    body: typeof record.body === 'string' ? record.body : ''
  }
}

type SendGridErrors = Partial<Record<keyof NormalizedSendGridState, string>>

function validate(values: NormalizedSendGridState): SendGridErrors {
  const errors: SendGridErrors = {}
  if (!values.apiKey.trim()) errors.apiKey = 'API key is required'
  if (!values.from.trim()) errors.from = 'From email is required'

  const recipients = values.to
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (recipients.length === 0) {
    errors.to = 'Recipient email(s) required'
  } else if (recipients.some((recipient) => !EMAIL_RX.test(recipient))) {
    errors.to = 'One or more recipient emails are invalid'
  } else if (new Set(recipients).size !== recipients.length) {
    errors.to = 'Duplicate recipient emails are not allowed'
  }

  if (!values.templateId.trim()) {
    if (!values.subject.trim()) errors.subject = 'Subject is required'
    if (!values.body.trim()) errors.body = 'Message body is required'
  }

  return errors
}

export default function SendGridAction({
  nodeId,
  canEdit = true
}: SendGridActionProps) {
  const params = useActionParams<SendGridParams>(nodeId, 'email')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit
  const [substitutionErrors, setSubstitutionErrors] = useState(false)
  const normalizedParams = normalizeParams(params)

  useEffect(() => {
    if (!normalizedParams.templateId.trim() && substitutionErrors) {
      setSubstitutionErrors(false)
    }
  }, [normalizedParams.templateId, substitutionErrors])

  const emitPatch = useCallback(
    (patch: Partial<SendGridParams>) => {
      if (!effectiveCanEdit) return

      const base: SendGridParams =
        params && typeof params === 'object' ? params : ({} as SendGridParams)
      const { dirty: _dirty, ...rest } = base

      const nextRaw = { ...rest, ...patch }
      const nextNormalized = normalizeParams(nextRaw)
      const nextErrors = validate(nextNormalized)
      const nextHasErrors =
        Object.keys(nextErrors).length > 0 ||
        (substitutionErrors && nextNormalized.templateId.trim().length > 0)

      updateNodeData(nodeId, {
        params: nextRaw,
        dirty: true,
        hasValidationErrors: nextHasErrors
      })
    },
    [effectiveCanEdit, nodeId, params, updateNodeData, substitutionErrors]
  )

  const errors = validate(normalizedParams)

  const hasValidationErrors = (() => {
    if (Object.keys(errors).length > 0) return true
    if (substitutionErrors && normalizedParams.templateId.trim()) return true
    return false
  })()

  useEffect(() => {
    updateNodeData(nodeId, { hasValidationErrors })
  }, [hasValidationErrors, nodeId, updateNodeData])

  return (
    <div className="flex flex-col gap-2">
      <NodeSecretDropdown
        group="email"
        service="sendgrid"
        value={normalizedParams.apiKey}
        onChange={(val) => emitPatch({ apiKey: val })}
        placeholder="Select SendGrid API key"
      />
      {errors.apiKey && <p className="text-xs text-red-500">{errors.apiKey}</p>}

      <NodeInputField
        type="email"
        placeholder="From Email"
        value={normalizedParams.from}
        onChange={(val) => emitPatch({ from: val })}
      />
      {errors.from && <p className="text-xs text-red-500">{errors.from}</p>}

      <NodeInputField
        type="text"
        placeholder="To (comma separated)"
        value={normalizedParams.to}
        onChange={(val) => emitPatch({ to: val })}
      />
      {errors.to && <p className="text-xs text-red-500">{errors.to}</p>}

      <NodeInputField
        placeholder="Template ID (optional)"
        value={normalizedParams.templateId}
        onChange={(val) => emitPatch({ templateId: val })}
      />

      {normalizedParams.templateId.trim() ? (
        <KeyValuePair
          title="Template Substitutions"
          variables={normalizedParams.substitutions}
          onChange={(updatedVars, nodeHasErrors) => {
            setSubstitutionErrors(nodeHasErrors)
            emitPatch({ substitutions: updatedVars })
          }}
        />
      ) : (
        <>
          <NodeInputField
            placeholder="Subject"
            value={normalizedParams.subject}
            onChange={(val) => emitPatch({ subject: val })}
          />
          {errors.subject && (
            <p className="text-xs text-red-500">{errors.subject}</p>
          )}
          <NodeTextAreaField
            placeholder="Body (plain text or HTML)"
            value={normalizedParams.body}
            rows={4}
            onChange={(val) => emitPatch({ body: val })}
          />
          {errors.body && <p className="text-xs text-red-500">{errors.body}</p>}
        </>
      )}
    </div>
  )
}

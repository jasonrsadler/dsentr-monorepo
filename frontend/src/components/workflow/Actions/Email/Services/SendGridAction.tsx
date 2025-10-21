import { useEffect, useMemo, useRef, useState } from 'react'
import deepEqual from 'fast-deep-equal'
import KeyValuePair from '@/components/ui/react-flow/KeyValuePair'
import NodeInputField from '@/components/ui/input-fields/NodeInputField'
import NodeSecretDropdown from '@/components/ui/input-fields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/ui/input-fields/NodeTextAreaField'

type SendGridSubstitution = { key: string; value: string }

type SendGridActionValues = {
  apiKey?: string
  from?: string
  to?: string
  templateId?: string
  substitutions?: SendGridSubstitution[]
  subject?: string
  body?: string
}

type NormalizedSendGridParams = {
  apiKey: string
  from: string
  to: string
  templateId: string
  substitutions: SendGridSubstitution[]
  subject: string
  body: string
}

type SendGridStringKey = Exclude<
  keyof NormalizedSendGridParams,
  'substitutions'
>

interface SendGridActionProps {
  args: SendGridActionValues
  onChange?: (
    args: SendGridActionValues,
    hasErrors: boolean,
    dirty: boolean
  ) => void
}

const normalizeSubstitutions = (
  entries: SendGridSubstitution[] | undefined
): SendGridSubstitution[] => {
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const key = typeof entry.key === 'string' ? entry.key : ''
      const value = typeof entry.value === 'string' ? entry.value : ''
      return { key, value }
    })
    .filter((entry): entry is SendGridSubstitution => Boolean(entry))
}

const normalizeParams = (
  incoming?: SendGridActionValues
): NormalizedSendGridParams => {
  const base: NormalizedSendGridParams = {
    apiKey: '',
    from: '',
    to: '',
    templateId: '',
    substitutions: [],
    subject: '',
    body: ''
  }

  if (!incoming || typeof incoming !== 'object') {
    return base
  }

  return {
    apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey : '',
    from: typeof incoming.from === 'string' ? incoming.from : '',
    to: typeof incoming.to === 'string' ? incoming.to : '',
    templateId:
      typeof incoming.templateId === 'string' ? incoming.templateId : '',
    substitutions: normalizeSubstitutions(incoming.substitutions),
    subject: typeof incoming.subject === 'string' ? incoming.subject : '',
    body: typeof incoming.body === 'string' ? incoming.body : ''
  }
}

const serializeParams = (params: NormalizedSendGridParams) =>
  JSON.stringify({
    ...params,
    substitutions: params.substitutions.map((entry) => ({ ...entry }))
  })

type SendGridErrors = Partial<Record<keyof NormalizedSendGridParams, string>>

const validate = (values: NormalizedSendGridParams): SendGridErrors => {
  const errors: SendGridErrors = {}
  if (!values.apiKey.trim()) errors.apiKey = 'API key is required'
  if (!values.from.trim()) errors.from = 'From email is required'

  const recipients = values.to
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (recipients.length === 0) {
    errors.to = 'Recipient email(s) required'
  } else if (recipients.some((recipient) => !emailRx.test(recipient))) {
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

const cloneParams = (params: NormalizedSendGridParams) => ({
  ...params,
  substitutions: params.substitutions.map((entry) => ({ ...entry }))
})

export default function SendGridAction({
  args,
  onChange
}: SendGridActionProps) {
  const initialParamsRef = useRef<NormalizedSendGridParams | null>(null)
  if (!initialParamsRef.current) {
    initialParamsRef.current = normalizeParams(args)
  }

  const [params, setParams] = useState<NormalizedSendGridParams>(
    initialParamsRef.current!
  )
  const [dirty, setDirty] = useState(false)
  const [childDirty, setChildDirty] = useState(false)
  const [childHasErrors, setChildHasErrors] = useState(false)

  const lastArgsSignatureRef = useRef<string>(
    serializeParams(initialParamsRef.current!)
  )
  const internalUpdateRef = useRef(false)
  const lastEmittedRef = useRef<{
    params: NormalizedSendGridParams
    hasErrors: boolean
    dirty: boolean
  } | null>(null)

  useEffect(() => {
    const normalized = normalizeParams(args)
    const signature = serializeParams(normalized)
    if (signature === lastArgsSignatureRef.current) {
      return
    }

    lastArgsSignatureRef.current = signature
    internalUpdateRef.current = true
    initialParamsRef.current = normalized
    setParams(normalized)
    setDirty(false)
    setChildDirty(false)
    setChildHasErrors(false)
  }, [args])

  const validationErrors = useMemo(() => validate(params), [params])
  const combinedDirty = dirty || childDirty

  useEffect(() => {
    if (params.templateId) return
    setChildHasErrors(false)
    setChildDirty(false)
  }, [params.templateId])

  useEffect(() => {
    if (!onChange) return

    if (internalUpdateRef.current) {
      internalUpdateRef.current = false
      return
    }
    const hasErrors = childHasErrors || Object.keys(validationErrors).length > 0
    const payload = cloneParams(params)
    const last = lastEmittedRef.current

    if (
      last &&
      last.dirty === combinedDirty &&
      last.hasErrors === hasErrors &&
      deepEqual(last.params, payload)
    ) {
      return
    }

    lastEmittedRef.current = {
      params: payload,
      hasErrors,
      dirty: combinedDirty
    }

    onChange(payload, hasErrors, combinedDirty)
  }, [childHasErrors, combinedDirty, onChange, params, validationErrors])

  const updateField = (key: SendGridStringKey, value: string) => {
    setParams((prev) => {
      if ((prev[key] as string) === value) {
        return prev
      }
      setDirty(true)
      return { ...prev, [key]: value }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <NodeSecretDropdown
        group="email"
        service="sendgrid"
        value={params.apiKey}
        onChange={(val) => updateField('apiKey', val)}
        placeholder="Select SendGrid API key"
      />
      {validationErrors.apiKey && (
        <p className="text-xs text-red-500">{validationErrors.apiKey}</p>
      )}

      <NodeInputField
        type="email"
        placeholder="From Email"
        value={params.from}
        onChange={(val) => updateField('from', val)}
      />
      {validationErrors.from && (
        <p className="text-xs text-red-500">{validationErrors.from}</p>
      )}

      <NodeInputField
        type="text"
        placeholder="Template ID (optional)"
        value={params.templateId}
        onChange={(val) => updateField('templateId', val)}
      />

      {params.templateId && (
        <KeyValuePair
          title="Substitution Variables"
          variables={params.substitutions}
          onChange={(updatedVars, nodeHasErrors, childDirtyState) => {
            const normalizedSubs = normalizeSubstitutions(updatedVars)
            setParams((prev) => {
              if (deepEqual(prev.substitutions, normalizedSubs)) {
                return prev
              }
              setDirty(true)
              return { ...prev, substitutions: normalizedSubs }
            })
            setChildDirty((prev) => prev || childDirtyState)
            setChildHasErrors(nodeHasErrors)
          }}
        />
      )}

      <NodeInputField
        type="text"
        placeholder="Recipient Email(s)"
        value={params.to}
        onChange={(val) => updateField('to', val)}
      />
      {validationErrors.to && (
        <p className="text-xs text-red-500">{validationErrors.to}</p>
      )}

      {!params.templateId && (
        <>
          <NodeInputField
            placeholder="Subject"
            value={params.subject}
            onChange={(val) => updateField('subject', val)}
          />
          {validationErrors.subject && (
            <p className="text-xs text-red-500">{validationErrors.subject}</p>
          )}

          <NodeTextAreaField
            placeholder="Message Body"
            value={params.body}
            rows={4}
            onChange={(val) => updateField('body', val)}
          />
          {validationErrors.body && (
            <p className="text-xs text-red-500">{validationErrors.body}</p>
          )}
        </>
      )}
    </div>
  )
}

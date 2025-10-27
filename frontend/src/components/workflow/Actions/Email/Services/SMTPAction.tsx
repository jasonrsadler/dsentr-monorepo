import { useCallback, useEffect } from 'react'

import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

type TlsMode = 'starttls' | 'implicit_tls' | 'none'

const TLS_MODE_OPTIONS: { value: TlsMode; label: string; helper?: string }[] = [
  {
    value: 'starttls',
    label: 'TLS - Use STARTTLS (recommended)',
    helper: 'Upgrades a plaintext connection to TLS on ports like 587.'
  },
  {
    value: 'implicit_tls',
    label: 'TLS/SSL - Use Implicit TLS/SSL (legacy - not recommended)',
    helper: 'Connects with TLS immediately (commonly port 465).'
  },
  {
    value: 'none',
    label: 'Do not use TLS (insecure - only if required)',
    helper: 'Only choose this when your SMTP server requires plaintext access.'
  }
]

interface SMTPParams {
  service?: string
  smtpHost?: string
  smtpPort?: number | string
  smtpUser?: string
  smtpPassword?: string
  smtpTls?: boolean
  smtpTlsMode?: string
  from?: string
  to?: string
  subject?: string
  body?: string
  dirty: boolean
}

interface NormalizedSMTPState {
  service?: string
  smtpHost: string
  smtpPort: number | ''
  smtpUser: string
  smtpPassword: string
  smtpTlsMode: TlsMode
  smtpTls: boolean
  from: string
  to: string
  subject: string
  body: string
}

interface SMTPActionProps {
  nodeId: string
  canEdit?: boolean
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isTlsMode = (value: unknown): value is TlsMode =>
  value === 'starttls' || value === 'implicit_tls' || value === 'none'

const parsePort = (value: unknown): number | '' => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return ''
}

const defaultPortForMode = (mode: TlsMode): number => {
  switch (mode) {
    case 'implicit_tls':
      return 465
    case 'none':
      return 25
    default:
      return 587
  }
}

function normalizeParams(params: SMTPParams | undefined): NormalizedSMTPState {
  const record =
    params && typeof params === 'object' ? params : ({} as SMTPParams)
  const port = parsePort(record.smtpPort)
  const tlsMode = (() => {
    if (isTlsMode(record.smtpTlsMode)) {
      return record.smtpTlsMode
    }
    const tlsEnabled =
      typeof record.smtpTls === 'boolean' ? record.smtpTls : true
    if (!tlsEnabled) return 'none'
    if (port === 465) return 'implicit_tls'
    return 'starttls'
  })()

  return {
    service: typeof record.service === 'string' ? record.service : undefined,
    smtpHost: typeof record.smtpHost === 'string' ? record.smtpHost : '',
    smtpPort: port,
    smtpUser: typeof record.smtpUser === 'string' ? record.smtpUser : '',
    smtpPassword:
      typeof record.smtpPassword === 'string' ? record.smtpPassword : '',
    smtpTlsMode: tlsMode,
    smtpTls: tlsMode !== 'none',
    from: typeof record.from === 'string' ? record.from : '',
    to: typeof record.to === 'string' ? record.to : '',
    subject: typeof record.subject === 'string' ? record.subject : '',
    body: typeof record.body === 'string' ? record.body : ''
  }
}

type SMTPErrors = Partial<Record<keyof NormalizedSMTPState, string>>

function validate(values: NormalizedSMTPState): SMTPErrors {
  const errors: SMTPErrors = {}
  if (!values.smtpHost.trim()) errors.smtpHost = 'SMTP Host is required'
  const portValue = values.smtpPort
  if (
    portValue === '' ||
    !Number.isFinite(portValue) ||
    Number(portValue) <= 0
  ) {
    errors.smtpPort = 'Valid SMTP Port is required'
  }
  if (!values.smtpUser.trim()) errors.smtpUser = 'SMTP User is required'
  if (!values.smtpPassword.trim()) {
    errors.smtpPassword = 'SMTP Password is required'
  }
  if (!values.from.trim()) errors.from = 'From email is required'
  if (!values.to.trim()) {
    errors.to = 'Recipient email(s) required'
  } else {
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
  }
  if (!values.subject.trim()) errors.subject = 'Subject is required'
  if (!values.body.trim()) errors.body = 'Message body is required'
  return errors
}

export default function SMTPAction({
  nodeId,
  canEdit = true
}: SMTPActionProps) {
  const params = useActionParams<SMTPParams>(nodeId, 'email')
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData)
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit
  const normalizedParams = normalizeParams(params)

  const emitPatch = useCallback(
    (patch: Partial<SMTPParams>) => {
      if (!effectiveCanEdit) return

      const base: SMTPParams =
        params && typeof params === 'object' ? params : ({} as SMTPParams)
      const { dirty: _dirty, ...rest } = base
      const nextRaw = { ...rest, ...patch }
      const nextNormalized = normalizeParams(nextRaw)
      const nextErrors = validate(nextNormalized)
      updateNodeData(nodeId, {
        params: nextRaw,
        dirty: true,
        hasValidationErrors: Object.keys(nextErrors).length > 0
      })
    },
    [effectiveCanEdit, nodeId, params, updateNodeData]
  )

  const errors = validate(normalizedParams)
  const hasValidationErrors = Object.keys(errors).length > 0

  useEffect(() => {
    updateNodeData(nodeId, { hasValidationErrors })
  }, [hasValidationErrors, nodeId, updateNodeData])

  const handleTlsModeChange = useCallback(
    (mode: TlsMode) => {
      if (!effectiveCanEdit) return
      const previousMode = normalizedParams.smtpTlsMode
      const previousPort = normalizedParams.smtpPort
      const prevDefault = defaultPortForMode(previousMode)
      const nextDefault = defaultPortForMode(mode)
      const hasValidPort = typeof previousPort === 'number' && previousPort > 0
      const shouldSnapPort =
        !hasValidPort ||
        previousPort === prevDefault ||
        previousPort === nextDefault

      emitPatch({
        smtpTlsMode: mode,
        smtpTls: mode !== 'none',
        smtpPort: shouldSnapPort ? nextDefault : previousPort
      })
    },
    [
      emitPatch,
      normalizedParams.smtpPort,
      normalizedParams.smtpTlsMode,
      effectiveCanEdit
    ]
  )

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="SMTP Host"
        value={normalizedParams.smtpHost}
        onChange={(val) => emitPatch({ smtpHost: val })}
      />
      {errors.smtpHost && <p className={errorClass}>{errors.smtpHost}</p>}
      <NodeInputField
        placeholder="SMTP Port"
        type="number"
        value={
          typeof normalizedParams.smtpPort === 'number'
            ? normalizedParams.smtpPort.toString()
            : ''
        }
        onChange={(val) => {
          const trimmed = val.trim()
          if (!trimmed) {
            emitPatch({ smtpPort: '' })
            return
          }
          const parsed = Number(trimmed)
          if (!Number.isFinite(parsed) || parsed <= 0) {
            emitPatch({ smtpPort: '' })
            return
          }
          emitPatch({ smtpPort: parsed })
        }}
      />
      {errors.smtpPort && <p className={errorClass}>{errors.smtpPort}</p>}
      <NodeInputField
        placeholder="Username"
        value={normalizedParams.smtpUser}
        onChange={(val) => emitPatch({ smtpUser: val })}
      />
      {errors.smtpUser && <p className={errorClass}>{errors.smtpUser}</p>}
      <NodeSecretDropdown
        group="email"
        service="smtp"
        value={normalizedParams.smtpPassword}
        onChange={(val) => emitPatch({ smtpPassword: val })}
        placeholder="Select SMTP password or API key"
      />
      {errors.smtpPassword && (
        <p className={errorClass}>{errors.smtpPassword}</p>
      )}
      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="font-medium">Encryption</legend>
        {TLS_MODE_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input
              type="radio"
              name="smtp-tls-mode"
              value={option.value}
              checked={normalizedParams.smtpTlsMode === option.value}
              aria-label={option.label}
              onChange={() => handleTlsModeChange(option.value)}
            />
            <span>
              {option.label}
              {option.helper && (
                <span
                  className="block text-[10px] text-slate-400"
                  aria-hidden="true"
                >
                  {option.helper}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <NodeInputField
        type="email"
        placeholder="Sender Email"
        value={normalizedParams.from}
        onChange={(val) => emitPatch({ from: val })}
      />
      {errors.from && <p className={errorClass}>{errors.from}</p>}
      <NodeInputField
        type="text"
        placeholder="Recipient Email(s)"
        value={normalizedParams.to}
        onChange={(val) => emitPatch({ to: val })}
      />
      {errors.to && <p className={errorClass}>{errors.to}</p>}
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
    </div>
  )
}

import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeSecretDropdown from '@/components/UI/InputFields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import { useEffect, useMemo, useState } from 'react'

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

const isTlsMode = (value: unknown): value is TlsMode =>
  value === 'starttls' || value === 'implicit_tls' || value === 'none'

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

interface SMTPActionProps {
  smtpHost: string
  smtpPort: number | string
  smtpUser: string
  smtpPassword: string
  smtpTls?: boolean
  smtpTlsMode?: TlsMode
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
  const initialPort = (() => {
    if (typeof args.smtpPort === 'number' && args.smtpPort > 0)
      return args.smtpPort
    if (typeof args.smtpPort === 'string') {
      const trimmed = args.smtpPort.trim()
      if (trimmed) {
        const parsed = Number(trimmed)
        if (!Number.isNaN(parsed) && parsed > 0) return parsed
      }
    }
    return 587
  })()
  const initialTlsMode: TlsMode = (() => {
    if (isTlsMode(args.smtpTlsMode)) return args.smtpTlsMode
    const tlsEnabled = typeof args.smtpTls === 'boolean' ? args.smtpTls : true
    if (!tlsEnabled) return 'none'
    if (initialPort === 465) return 'implicit_tls'
    return 'starttls'
  })()

  const [params, setParams] = useState<Partial<SMTPActionProps>>({
    ...args,
    smtpPort: initialPort,
    smtpTlsMode: initialTlsMode,
    smtpTls: initialTlsMode !== 'none'
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
  const selectedTlsMode = isTlsMode(params.smtpTlsMode)
    ? params.smtpTlsMode
    : initialTlsMode

  const handleTlsModeChange = (mode: TlsMode) => {
    setDirty(true)
    setParams((prev) => {
      const previousMode = isTlsMode(prev.smtpTlsMode)
        ? prev.smtpTlsMode
        : initialTlsMode
      const prevPortValue =
        typeof prev.smtpPort === 'number'
          ? prev.smtpPort
          : Number(prev.smtpPort)
      const hasValidPort =
        prev.smtpPort !== undefined &&
        prev.smtpPort !== '' &&
        Number.isFinite(prevPortValue) &&
        prevPortValue > 0
      const prevDefault = defaultPortForMode(previousMode)
      const nextDefault = defaultPortForMode(mode)
      const shouldSnapPort =
        !hasValidPort ||
        prevPortValue === prevDefault ||
        prevPortValue === nextDefault

      return {
        ...prev,
        smtpTlsMode: mode,
        smtpTls: mode !== 'none',
        smtpPort: shouldSnapPort ? nextDefault : prev.smtpPort
      }
    })
  }

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
        value={
          typeof params.smtpPort === 'number'
            ? params.smtpPort.toString()
            : params.smtpPort?.toString() || ''
        }
        onChange={(val) => {
          const parsed = val ? Number(val) : ''
          updateField('smtpPort', parsed === '' ? '' : parsed)
        }}
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
      <NodeSecretDropdown
        group="email"
        service="smtp"
        value={params.smtpPassword || ''}
        onChange={(val) => updateField('smtpPassword', val)}
        placeholder="Select SMTP password or API key"
      />
      {smtpErrors.smtpPassword && (
        <p className={errorClass}>{smtpErrors.smtpPassword}</p>
      )}
      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="font-medium">Encryption</legend>
        {TLS_MODE_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input
              type="radio"
              name="smtp-tls-mode"
              value={option.value}
              checked={selectedTlsMode === option.value}
              onChange={() => handleTlsModeChange(option.value)}
            />
            <span>
              {option.label}
              {option.helper && (
                <span className="block text-[10px] text-slate-400">
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

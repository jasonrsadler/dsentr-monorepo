import { useEffect, useMemo, useState } from 'react'
import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'

export interface TeamsActionValues {
  deliveryMethod?: string
  webhookType?: string
  webhookUrl?: string
  title?: string
  summary?: string
  themeColor?: string
  message?: string
  cardJson?: string
  workflowOption?: string
  workflowRawJson?: string
  workflowHeaderName?: string
  workflowHeaderSecret?: string
}

interface TeamsActionProps {
  args: TeamsActionValues
  initialDirty?: boolean
  onChange?: (
    args: TeamsActionValues,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
}

const deliveryOptions = [
  'Incoming Webhook',
  'Teams Bot (Bot Framework)',
  'Delegated OAuth (Post as user)'
]

const webhookOptions = ['Connector', 'Workflow/Power Automate']

const workflowOptions = ['Basic (Raw JSON)', 'Header Secret Auth']

const normalizeParams = (incoming?: TeamsActionValues): TeamsActionValues => {
  const base: TeamsActionValues = {
    deliveryMethod: deliveryOptions[0],
    webhookType: webhookOptions[0],
    webhookUrl: '',
    title: '',
    summary: '',
    themeColor: '',
    message: '',
    cardJson: '',
    workflowOption: workflowOptions[0],
    workflowRawJson: '',
    workflowHeaderName: '',
    workflowHeaderSecret: ''
  }

  if (!incoming) return base

  const next: TeamsActionValues = { ...base }
  ;(Object.keys(base) as (keyof TeamsActionValues)[]).forEach((key) => {
    const value = incoming[key]
    if (typeof value === 'string') {
      next[key] = value
    }
  })
  return next
}

const sanitizeForSelection = (
  current: TeamsActionValues,
  {
    isIncomingWebhook,
    isConnector,
    isWorkflow,
    workflowUsesHeaderSecret
  }: {
    isIncomingWebhook: boolean
    isConnector: boolean
    isWorkflow: boolean
    workflowUsesHeaderSecret: boolean
  }
): TeamsActionValues => {
  const normalized = normalizeParams(current)
  const sanitized: TeamsActionValues = { ...normalized }

  if (!isIncomingWebhook) {
    sanitized.webhookType = webhookOptions[0]
    sanitized.webhookUrl = ''
    sanitized.title = ''
    sanitized.summary = ''
    sanitized.themeColor = ''
    sanitized.message = ''
    sanitized.cardJson = ''
    sanitized.workflowOption = ''
    sanitized.workflowRawJson = ''
    sanitized.workflowHeaderName = ''
    sanitized.workflowHeaderSecret = ''
    return sanitized
  }

  if (isConnector) {
    sanitized.workflowOption = ''
    sanitized.workflowRawJson = ''
    sanitized.workflowHeaderName = ''
    sanitized.workflowHeaderSecret = ''
  }

  if (isWorkflow) {
    sanitized.title = ''
    sanitized.themeColor = ''
    sanitized.message = ''
    sanitized.summary = ''
    sanitized.cardJson = ''

    if (workflowUsesHeaderSecret) {
      sanitized.workflowHeaderName = sanitized.workflowHeaderName || ''
      sanitized.workflowHeaderSecret = sanitized.workflowHeaderSecret || ''
    } else {
      sanitized.workflowHeaderName = ''
      sanitized.workflowHeaderSecret = ''
    }
  } else {
    sanitized.cardJson = ''
    sanitized.workflowOption = ''
    sanitized.workflowRawJson = ''
    sanitized.workflowHeaderName = ''
    sanitized.workflowHeaderSecret = ''
  }

  return sanitized
}

const shallowEqual = (a: TeamsActionValues, b: TeamsActionValues) => {
  const keys = new Set([
    ...(Object.keys(a) as string[]),
    ...(Object.keys(b) as string[])
  ])
  for (const key of keys) {
    if (
      (a as Record<string, string | undefined>)[key] !==
      (b as Record<string, string | undefined>)[key]
    )
      return false
  }
  return true
}

export default function TeamsAction({
  args,
  initialDirty = false,
  onChange
}: TeamsActionProps) {
  const [params, setParams] = useState<TeamsActionValues>(() =>
    normalizeParams(args)
  )
  const [dirty, setDirty] = useState(initialDirty)

  useEffect(() => {
    setParams((prev) => {
      const next = normalizeParams(args)
      return shallowEqual(prev, next) ? prev : next
    })
  }, [args])

  useEffect(() => {
    setDirty(initialDirty)
  }, [initialDirty])

  const isIncomingWebhook = params.deliveryMethod === deliveryOptions[0]
  const isConnector =
    isIncomingWebhook && params.webhookType === webhookOptions[0]
  const isWorkflow =
    isIncomingWebhook && params.webhookType === webhookOptions[1]

  const workflowOption =
    params.workflowOption && workflowOptions.includes(params.workflowOption)
      ? params.workflowOption
      : workflowOptions[0]
  const workflowUsesHeaderSecret = workflowOption === workflowOptions[1]

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}

    const deliveryMethod = params.deliveryMethod?.trim() ?? ''
    if (!deliveryMethod) {
      errors.deliveryMethod = 'Delivery method is required'
    } else if (deliveryMethod !== deliveryOptions[0]) {
      errors.deliveryMethod = 'Only Incoming Webhook is currently supported'
    }

    if (isIncomingWebhook) {
      if (!params.webhookType?.trim()) {
        errors.webhookType = 'Webhook type is required'
      }
      if (!params.webhookUrl?.trim()) {
        errors.webhookUrl = 'Webhook URL is required'
      }

      if (isConnector && params.themeColor?.trim()) {
        const sanitized = params.themeColor.trim().replace(/^#/, '')
        const hexRegex = /^[0-9a-fA-F]{6}$/
        if (!hexRegex.test(sanitized)) {
          errors.themeColor = 'Theme color must be a 6-digit hex value'
        }
      }

      if (isConnector && !params.message?.trim()) {
        errors.message = 'Message cannot be empty'
      }

      if (isWorkflow) {
        if (!params.workflowOption?.trim()) {
          errors.workflowOption = 'Workflow option is required'
        }

        const raw = params.workflowRawJson?.trim()
        if (!raw) {
          errors.workflowRawJson = 'Raw JSON payload is required'
        } else {
          try {
            JSON.parse(raw)
          } catch (error) {
            errors.workflowRawJson = 'Raw JSON payload must be valid JSON'
          }
        }

        if (workflowUsesHeaderSecret) {
          if (!params.workflowHeaderName?.trim()) {
            errors.workflowHeaderName = 'Header name is required'
          }
          if (!params.workflowHeaderSecret?.trim()) {
            errors.workflowHeaderSecret = 'Header secret is required'
          }
        }
      }
    }

    return errors
  }, [
    params,
    isConnector,
    isIncomingWebhook,
    isWorkflow,
    workflowUsesHeaderSecret
  ])

  const sanitizedOutput = useMemo(
    () =>
      sanitizeForSelection(params, {
        isIncomingWebhook,
        isConnector,
        isWorkflow,
        workflowUsesHeaderSecret
      }),
    [
      params,
      isIncomingWebhook,
      isConnector,
      isWorkflow,
      workflowUsesHeaderSecret
    ]
  )

  useEffect(() => {
    onChange?.(sanitizedOutput, Object.keys(validationErrors).length > 0, dirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sanitizedOutput, validationErrors, dirty])

  const updateField = (key: keyof TeamsActionValues, value: string) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'
  const helperClass = 'text-[10px] text-zinc-500 dark:text-zinc-400'

  return (
    <div className="flex flex-col gap-2">
      <NodeDropdownField
        options={deliveryOptions}
        value={params.deliveryMethod}
        onChange={(val) => updateField('deliveryMethod', val)}
      />
      {validationErrors.deliveryMethod && (
        <p className={errorClass}>{validationErrors.deliveryMethod}</p>
      )}
      {!isIncomingWebhook && (
        <p className={helperClass}>
          Teams bots and delegated messaging will be available soon. Configure
          an incoming webhook to send messages today.
        </p>
      )}

      {isIncomingWebhook && (
        <div className="flex flex-col gap-2">
          <NodeDropdownField
            options={webhookOptions}
            value={params.webhookType}
            onChange={(val) => updateField('webhookType', val)}
          />
          {validationErrors.webhookType && (
            <p className={errorClass}>{validationErrors.webhookType}</p>
          )}

          <>
            <NodeInputField
              placeholder="Webhook URL"
              value={params.webhookUrl || ''}
              onChange={(val) => updateField('webhookUrl', val)}
            />
            {validationErrors.webhookUrl && (
              <p className={errorClass}>{validationErrors.webhookUrl}</p>
            )}
          </>

          {isConnector && (
            <>
              <NodeInputField
                placeholder="Card Title (optional)"
                value={params.title || ''}
                onChange={(val) => updateField('title', val)}
              />
              <NodeInputField
                placeholder="Summary (optional)"
                value={params.summary || ''}
                onChange={(val) => updateField('summary', val)}
              />
              <NodeInputField
                placeholder="Theme Color (hex, optional)"
                value={params.themeColor || ''}
                onChange={(val) => updateField('themeColor', val)}
              />
              {validationErrors.themeColor && (
                <p className={errorClass}>{validationErrors.themeColor}</p>
              )}
              <p className={helperClass}>
                Connector webhooks send legacy message cards. Leave optional
                fields blank for a simple text card.
              </p>

              <NodeInputField
                placeholder="Message"
                value={params.message || ''}
                onChange={(val) => updateField('message', val)}
              />
              {validationErrors.message && (
                <p className={errorClass}>{validationErrors.message}</p>
              )}
            </>
          )}

          {isWorkflow && (
            <>
              <NodeDropdownField
                options={workflowOptions}
                value={workflowOption}
                onChange={(val) => updateField('workflowOption', val)}
              />
              {validationErrors.workflowOption && (
                <p className={errorClass}>{validationErrors.workflowOption}</p>
              )}

              <NodeTextAreaField
                placeholder="Raw JSON payload"
                value={params.workflowRawJson || ''}
                onChange={(val) => updateField('workflowRawJson', val)}
                rows={8}
              />
              {validationErrors.workflowRawJson && (
                <p className={errorClass}>{validationErrors.workflowRawJson}</p>
              )}
              <p className={helperClass}>
                Paste the exact JSON body that Power Automate should receive.
                Workflow context variables are not expanded automatically for
                these hooks.
              </p>

              {workflowUsesHeaderSecret && (
                <>
                  <NodeInputField
                    placeholder="Header Name"
                    value={params.workflowHeaderName || ''}
                    onChange={(val) => updateField('workflowHeaderName', val)}
                  />
                  {validationErrors.workflowHeaderName && (
                    <p className={errorClass}>
                      {validationErrors.workflowHeaderName}
                    </p>
                  )}
                  <NodeInputField
                    placeholder="Header Secret"
                    type="password"
                    value={params.workflowHeaderSecret || ''}
                    onChange={(val) => updateField('workflowHeaderSecret', val)}
                  />
                  {validationErrors.workflowHeaderSecret && (
                    <p className={errorClass}>
                      {validationErrors.workflowHeaderSecret}
                    </p>
                  )}
                  <p className={helperClass}>
                    The header secret will be stored securely and attached to
                    every webhook invocation.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

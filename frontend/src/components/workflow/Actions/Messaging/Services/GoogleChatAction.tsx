import { useEffect, useMemo, useRef, useState } from 'react'
import NodeDropdownField from '@/components/ui/input-fields/NodeDropdownField'
import NodeInputField from '@/components/ui/input-fields/NodeInputField'
import NodeTextAreaField from '@/components/ui/input-fields/NodeTextAreaField'

export interface GoogleChatActionValues {
  webhookUrl?: string
  message?: string
  cardJson?: string
}

const normalizeParams = (
  incoming?: GoogleChatActionValues
): GoogleChatActionValues => {
  const base: GoogleChatActionValues = {
    webhookUrl: '',
    message: '',
    cardJson: ''
  }

  if (!incoming) return base

  const next: GoogleChatActionValues = { ...base }
  ;(Object.keys(base) as (keyof GoogleChatActionValues)[]).forEach((key) => {
    const value = incoming[key]
    if (typeof value === 'string') {
      next[key] = value
    }
  })
  return next
}

interface GoogleChatActionProps {
  args: GoogleChatActionValues
  initialDirty?: boolean
  onChange?: (
    args: GoogleChatActionValues,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
}

export default function GoogleChatAction({
  args,
  initialDirty = false,
  onChange
}: GoogleChatActionProps) {
  const normalizedArgs = useMemo(() => normalizeParams(args), [args])
  const [params, setParams] = useState<GoogleChatActionValues>(normalizedArgs)
  const [dirty, setDirty] = useState(initialDirty)
  const [cardDraft, setCardDraft] = useState(normalizedArgs.cardJson || '')
  const [mode, setMode] = useState<'text' | 'card'>(
    normalizedArgs.cardJson?.trim() ? 'card' : 'text'
  )
  const dirtyRef = useRef(dirty)

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    const next = normalizedArgs
    setParams((prev) => {
      const same =
        (prev.webhookUrl ?? '') === (next.webhookUrl ?? '') &&
        (prev.message ?? '') === (next.message ?? '') &&
        (prev.cardJson ?? '') === (next.cardJson ?? '')
      return same ? prev : next
    })

    if (next.cardJson?.trim()) {
      setCardDraft(next.cardJson)
    }

    if (!dirtyRef.current && !initialDirty) {
      setMode(next.cardJson?.trim() ? 'card' : 'text')
    }
  }, [normalizedArgs, initialDirty])

  useEffect(() => {
    setDirty(initialDirty)
  }, [initialDirty])

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!params.webhookUrl?.trim())
      errors.webhookUrl = 'Webhook URL is required'
    if (mode === 'card') {
      const raw = params.cardJson ?? ''
      if (!raw.trim()) {
        errors.cardJson = 'Card JSON is required'
      } else {
        try {
          const parsed = JSON.parse(raw)
          if (!parsed || typeof parsed !== 'object') {
            errors.cardJson = 'Card JSON must be an object'
          } else if (
            !Object.prototype.hasOwnProperty.call(parsed, 'cards') &&
            !Object.prototype.hasOwnProperty.call(parsed, 'cardsV2')
          ) {
            errors.cardJson = "Card JSON must include 'cards' or 'cardsV2'"
          }
        } catch {
          errors.cardJson = 'Card JSON must be valid JSON'
        }
      }
    } else if (!params.message?.trim()) {
      errors.message = 'Message cannot be empty'
    }
    return errors
  }, [params, mode])

  useEffect(() => {
    const effectiveParams: GoogleChatActionValues =
      mode === 'card'
        ? params
        : {
            ...params,
            cardJson: ''
          }
    onChange?.(effectiveParams, Object.keys(validationErrors).length > 0, dirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, validationErrors, dirty, mode])

  const updateField = (key: keyof GoogleChatActionValues, value: string) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
    if (key === 'cardJson') {
      setCardDraft(value)
    }
  }

  const errorClass = 'text-xs text-red-500'
  const helperClass = 'text-xs text-zinc-500 dark:text-zinc-400'
  const payloadOptions = ['Text message', 'Card JSON (cardsV2)'] as const
  const selectedLabel = mode === 'card' ? payloadOptions[1] : payloadOptions[0]

  const handleModeChange = (value: string) => {
    const nextMode = value === payloadOptions[1] ? 'card' : 'text'
    if (nextMode === mode) return
    setDirty(true)
    setMode(nextMode)

    if (nextMode === 'card') {
      setParams((prev) => ({
        ...prev,
        cardJson: prev.cardJson?.trim() ? prev.cardJson : cardDraft
      }))
    } else {
      setParams((prev) => {
        const current = prev.cardJson ?? ''
        if (current.trim()) {
          setCardDraft(current)
        }
        return { ...prev, cardJson: '' }
      })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className={helperClass}>
        Use your Google Chat webhook URL. Send simple text or provide a cardsV2
        JSON payload.
      </p>
      <NodeInputField
        placeholder="Webhook URL"
        value={params.webhookUrl || ''}
        onChange={(val) => updateField('webhookUrl', val)}
      />
      {validationErrors.webhookUrl && (
        <p className={errorClass}>{validationErrors.webhookUrl}</p>
      )}
      <NodeDropdownField
        options={[...payloadOptions]}
        value={selectedLabel}
        onChange={handleModeChange}
      />
      {mode === 'text' ? (
        <>
          <NodeTextAreaField
            placeholder="Message"
            value={params.message || ''}
            onChange={(val) => updateField('message', val)}
            rows={4}
          />
          {validationErrors.message && (
            <p className={errorClass}>{validationErrors.message}</p>
          )}
        </>
      ) : (
        <>
          <NodeTextAreaField
            placeholder="cardsV2 JSON"
            value={params.cardJson || ''}
            onChange={(val) => updateField('cardJson', val)}
            rows={6}
          />
          {validationErrors.cardJson && (
            <p className={errorClass}>{validationErrors.cardJson}</p>
          )}
        </>
      )}
    </div>
  )
}

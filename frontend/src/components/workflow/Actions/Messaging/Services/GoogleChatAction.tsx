import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import NodeDropdownField from '@/components/ui/InputFields/NodeDropdownField'
import NodeInputField from '@/components/ui/InputFields/NodeInputField'
import NodeTextAreaField from '@/components/ui/InputFields/NodeTextAreaField'
import { useActionParams } from '@/stores/workflowSelectors'
import { useWorkflowStore } from '@/stores/workflowStore'

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const computeValidationErrors = (
  params: GoogleChatActionValues,
  mode: 'text' | 'card'
) => {
  const errors: Record<string, string> = {}
  if (!params.webhookUrl?.trim()) errors.webhookUrl = 'Webhook URL is required'
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
}

const payloadOptions = ['Text message', 'Card JSON (cardsV2)'] as const

const shallowEqualParams = (
  a: GoogleChatActionValues,
  b: GoogleChatActionValues
) =>
  a.webhookUrl === b.webhookUrl &&
  a.message === b.message &&
  a.cardJson === b.cardJson

const prepareNextParams = (
  current: GoogleChatActionValues,
  patch: Partial<GoogleChatActionValues>,
  forceMode?: 'text' | 'card'
) => {
  const merged = normalizeParams({
    ...current,
    ...patch
  })

  const trimmedCard = merged.cardJson?.trim() ?? ''
  const nextMode: 'text' | 'card' = forceMode ?? (trimmedCard ? 'card' : 'text')

  const params: GoogleChatActionValues = {
    ...merged,
    cardJson: nextMode === 'card' ? trimmedCard : ''
  }

  const hasValidationErrors =
    Object.keys(computeValidationErrors(params, nextMode)).length > 0

  return { params, nextMode, hasValidationErrors }
}

const normalizeStoreParams = (
  params: Record<string, unknown>
): GoogleChatActionValues => {
  const googleChatPayload =
    (params['Google Chat'] as GoogleChatActionValues | undefined) ??
    (params.GoogleChat as GoogleChatActionValues | undefined) ??
    (params.googleChat as GoogleChatActionValues | undefined)

  if (googleChatPayload && typeof googleChatPayload === 'object') {
    return normalizeParams(googleChatPayload)
  }

  return normalizeParams(params as GoogleChatActionValues)
}

interface GoogleChatActionProps {
  nodeId: string
  canEdit?: boolean
}

export default function GoogleChatAction({
  nodeId,
  canEdit = true
}: GoogleChatActionProps) {
  const actionParams = useActionParams<Record<string, unknown>>(
    nodeId,
    'googleChat'
  )
  const storeCanEdit = useWorkflowStore((state) => state.canEdit)
  const effectiveCanEdit = canEdit && storeCanEdit

  const currentParams = useMemo(() => {
    if (isRecord(actionParams)) {
      return normalizeStoreParams(actionParams)
    }
    return normalizeParams(actionParams as GoogleChatActionValues)
  }, [actionParams])

  // Track selected payload mode locally so it doesn't revert
  // when cardJson is empty but user chose 'Card JSON'.
  const [mode, setMode] = useState<'text' | 'card'>(
    () => (currentParams.cardJson?.trim() ? 'card' : 'text')
  )

  // If params gain a cards payload externally, promote mode to 'card'.
  useEffect(() => {
    if (currentParams.cardJson?.trim() && mode !== 'card') {
      setMode('card')
    }
  }, [currentParams.cardJson, mode])

  const validationErrors = useMemo(
    () => computeValidationErrors(currentParams, mode),
    [currentParams, mode]
  )

  const hasValidationErrors = useMemo(
    () => Object.keys(validationErrors).length > 0,
    [validationErrors]
  )

  const cardDraftRef = useRef(currentParams.cardJson ?? '')
  useEffect(() => {
    if (mode === 'card' && currentParams.cardJson?.trim()) {
      cardDraftRef.current = currentParams.cardJson
    }
  }, [currentParams.cardJson, mode])

  const commitParams = useCallback(
    (
      params: GoogleChatActionValues,
      nextHasErrors: boolean,
      markDirty: boolean
    ) => {
      if (!effectiveCanEdit) return

      // Emit both flattened params and a namespaced variant under 'Google Chat'
      // to match store selectors and test expectations.
      const combinedParams = {
        ...params,
        'Google Chat': { ...params }
      }

      useWorkflowStore.getState().updateNodeData(nodeId, {
        params: combinedParams,
        ...(markDirty ? { dirty: true } : {}),
        hasValidationErrors: nextHasErrors
      })
    },
    [effectiveCanEdit, nodeId]
  )

  const handleFieldChange = useCallback(
    (key: keyof GoogleChatActionValues, value: string) => {
      if (!effectiveCanEdit) return
      const { params: nextParams } = prepareNextParams(currentParams, {
        [key]: value
      })

      const nextHasErrors =
        Object.keys(computeValidationErrors(nextParams, mode)).length > 0

      if (
        shallowEqualParams(currentParams, nextParams) &&
        nextHasErrors === hasValidationErrors
      ) {
        return
      }

      if (mode === 'card' && nextParams.cardJson?.trim()) {
        cardDraftRef.current = nextParams.cardJson
      }

      commitParams(nextParams, nextHasErrors, true)
    },
    [currentParams, effectiveCanEdit, hasValidationErrors, commitParams, mode]
  )

  const handleModeChange = useCallback(
    (value: string) => {
      if (!effectiveCanEdit) return
      const nextMode = value === payloadOptions[1] ? 'card' : 'text'
      if (nextMode === mode) return

      setMode(nextMode)

      if (nextMode === 'card') {
        const draft = currentParams.cardJson?.trim()
          ? currentParams.cardJson
          : cardDraftRef.current

        const { params: nextParams, hasValidationErrors: nextHasErrors } =
          prepareNextParams(currentParams, { cardJson: draft || '' }, 'card')

        if (
          shallowEqualParams(currentParams, nextParams) &&
          nextHasErrors === hasValidationErrors
        ) {
          return
        }

        if (nextParams.cardJson?.trim()) {
          cardDraftRef.current = nextParams.cardJson
        }

        commitParams(nextParams, nextHasErrors, true)
        return
      }

      const currentCard = currentParams.cardJson ?? ''
      if (currentCard.trim()) {
        cardDraftRef.current = currentCard
      }

      const { params: nextParams, hasValidationErrors: nextHasErrors } =
        prepareNextParams(currentParams, { cardJson: '' }, 'text')

      if (
        shallowEqualParams(currentParams, nextParams) &&
        nextHasErrors === hasValidationErrors
      ) {
        return
      }

      commitParams(nextParams, nextHasErrors, true)
    },
    [currentParams, effectiveCanEdit, hasValidationErrors, commitParams, mode]
  )

  const dropdownOptions = useMemo(() => [...payloadOptions], [])
  const errorClass = 'text-xs text-red-500'
  const helperClass = 'text-xs text-zinc-500 dark:text-zinc-400'
  const selectedLabel = mode === 'card' ? payloadOptions[1] : payloadOptions[0]

  return (
    <div className="flex flex-col gap-2">
      <p className={helperClass}>
        Use your Google Chat webhook URL. Send simple text or provide a cardsV2
        JSON payload.
      </p>
      <NodeInputField
        placeholder="Webhook URL"
        value={currentParams.webhookUrl || ''}
        onChange={(val) => handleFieldChange('webhookUrl', val)}
      />
      {validationErrors.webhookUrl && (
        <p className={errorClass}>{validationErrors.webhookUrl}</p>
      )}
      <NodeDropdownField
        options={dropdownOptions}
        value={selectedLabel}
        onChange={handleModeChange}
      />
      {mode === 'text' ? (
        <>
          <NodeTextAreaField
            placeholder="Message"
            value={currentParams.message || ''}
            onChange={(val) => handleFieldChange('message', val)}
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
            value={currentParams.cardJson || ''}
            onChange={(val) => handleFieldChange('cardJson', val)}
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

import { useState, useEffect, useMemo, useRef } from 'react'
import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import SlackAction from './Services/SlackAction'
import TeamsAction from './Services/TeamsAction'
import GoogleChatAction from './Services/GoogleChatAction'

type MessagingPlatform = 'Slack' | 'Teams' | 'Google Chat'

type PlatformParams = Record<string, any>

const DEFAULT_TEAMS_CARD_MODE = 'Simple card builder'

const allowedKeys: Record<MessagingPlatform, string[]> = {
  Slack: ['channel', 'message', 'token'],
  Teams: [
    'deliveryMethod',
    'webhookType',
    'webhookUrl',
    'title',
    'summary',
    'themeColor',
    'message',
    'cardJson',
    'cardMode',
    'cardTitle',
    'cardBody',
    'workflowOption',
    'workflowRawJson',
    'workflowHeaderName',
    'workflowHeaderSecret',
    'oauthProvider',
    'oauthConnectionId',
    'oauthAccountEmail',
    'teamId',
    'teamName',
    'channelId',
    'channelName',
    'messageType',
    'mentions'
  ],
  'Google Chat': ['webhookUrl', 'message', 'cardJson']
}

const sanitizeParams = (
  platform: MessagingPlatform,
  params: Record<string, any>
): PlatformParams => {
  const keys = allowedKeys[platform]
  const sanitized = keys.reduce<PlatformParams>((acc, key) => {
    const value = params?.[key]
    if (Array.isArray(value)) {
      acc[key] = value.map((entry) =>
        typeof entry === 'object' && entry !== null ? { ...entry } : entry
      )
    } else if (value === undefined || value === null) {
      acc[key] = key === 'mentions' ? [] : ''
    } else if (typeof value === 'object') {
      acc[key] = { ...value }
    } else if (typeof value === 'string') {
      acc[key] = value
    } else {
      acc[key] = String(value)
    }
    return acc
  }, {} as PlatformParams)

  if (platform === 'Teams') {
    const deliveryMethod =
      typeof sanitized.deliveryMethod === 'string'
        ? sanitized.deliveryMethod.trim()
        : ''

    if (!deliveryMethod) sanitized.deliveryMethod = 'Incoming Webhook'

    const effectiveDeliveryMethod = deliveryMethod || 'Incoming Webhook'

    if (
      effectiveDeliveryMethod === 'Incoming Webhook' &&
      !sanitized.webhookType
    ) {
      sanitized.webhookType = 'Connector'
    }

    if (effectiveDeliveryMethod === 'Delegated OAuth (Post as user)') {
      if (!sanitized.messageType) sanitized.messageType = 'Text'
      if (!Array.isArray(sanitized.mentions)) sanitized.mentions = []
      if (
        typeof sanitized.cardMode !== 'string' ||
        !sanitized.cardMode.trim()
      ) {
        sanitized.cardMode = DEFAULT_TEAMS_CARD_MODE
      }
      if (sanitized.messageType === 'Card') {
        sanitized.cardTitle =
          typeof sanitized.cardTitle === 'string' ? sanitized.cardTitle : ''
        sanitized.cardBody =
          typeof sanitized.cardBody === 'string' ? sanitized.cardBody : ''
      } else {
        sanitized.cardTitle = ''
        sanitized.cardBody = ''
      }
    } else {
      // Ensure non-delegated payloads don't accidentally carry mention data
      sanitized.messageType = sanitized.messageType || ''
      sanitized.mentions = Array.isArray(sanitized.mentions)
        ? sanitized.mentions
        : []
      sanitized.cardMode = DEFAULT_TEAMS_CARD_MODE
      sanitized.cardTitle = ''
      sanitized.cardBody = ''
    }
  }

  return sanitized
}

interface MessagingActionProps {
  args: any
  onChange?: (args: any, nodeHasErrors: boolean, childDirty: boolean) => void
  disabledPlatforms?: Partial<Record<MessagingPlatform, string>>
  restrictedPlatform?: 'slack' | 'teams' | null
  restrictionMessage?: string | null
  onRestrictionNotice?: (message: string) => void
  onUpgradeClick?: () => void
}

export default function MessagingAction({
  args,
  onChange,
  disabledPlatforms = {},
  restrictedPlatform = null,
  restrictionMessage = null,
  onRestrictionNotice,
  onUpgradeClick
}: MessagingActionProps) {
  const [initialPlatform] = useState<MessagingPlatform>(
    (args?.platform as MessagingPlatform) || 'Slack'
  )
  const platformCacheRef = useRef<Record<MessagingPlatform, PlatformParams>>({
    Slack: sanitizeParams('Slack', {}),
    Teams: sanitizeParams('Teams', {}),
    'Google Chat': sanitizeParams('Google Chat', {})
  })
  const platformErrorsRef = useRef<Record<MessagingPlatform, boolean>>({
    Slack: false,
    Teams: false,
    'Google Chat': false
  })
  const platformDirtyRef = useRef<Record<MessagingPlatform, boolean>>({
    Slack: false,
    Teams: false,
    'Google Chat': false
  })

  const [initialChildParams] = useState<PlatformParams>(() =>
    sanitizeParams(initialPlatform, {
      ...(args || {}),
      platform: undefined
    })
  )

  useEffect(() => {
    platformCacheRef.current[initialPlatform] = initialChildParams
  }, [initialChildParams, initialPlatform])

  const [platform, setPlatform] = useState<MessagingPlatform>(initialPlatform)
  const [childParams, setChildParams] =
    useState<PlatformParams>(initialChildParams)
  const [childHasErrors, setChildHasErrors] = useState(false)
  const [childDirty, setChildDirty] = useState(false)

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!platform) errors.platform = 'Platform is required'
    return errors
  }, [platform])

  const combinedDirty = childDirty || platform !== initialPlatform

  useEffect(() => {
    platformCacheRef.current[platform] = childParams
    platformErrorsRef.current[platform] = childHasErrors
    platformDirtyRef.current[platform] = childDirty
  }, [platform, childParams, childHasErrors, childDirty])

  useEffect(() => {
    onChange?.(
      { ...childParams, platform },
      childHasErrors || Object.keys(validationErrors).length > 0,
      combinedDirty
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childParams, platform, childHasErrors, validationErrors, combinedDirty])

  const handlePlatformChange = (value: string) => {
    const nextPlatform = (value as MessagingPlatform) || 'Slack'
    // Persist current platform state before switching
    platformCacheRef.current[platform] = childParams
    platformErrorsRef.current[platform] = childHasErrors
    platformDirtyRef.current[platform] = childDirty

    setPlatform(nextPlatform)
    const cachedParams = platformCacheRef.current[nextPlatform]
    setChildParams(cachedParams ?? sanitizeParams(nextPlatform, {}))
    setChildHasErrors(platformErrorsRef.current[nextPlatform] ?? false)
    setChildDirty(platformDirtyRef.current[nextPlatform] ?? false)
  }

  const handleChildChange = (
    updated: PlatformParams,
    hasErrors: boolean,
    isDirty: boolean
  ) => {
    const sanitized = sanitizeParams(platform, updated)
    setChildParams(sanitized)
    setChildHasErrors(hasErrors)
    setChildDirty(isDirty)
  }

  const errorClass = 'text-xs text-red-500'

  const dropdownOptions = useMemo(
    () =>
      (['Slack', 'Teams', 'Google Chat'] as MessagingPlatform[]).map(
        (label) => ({
          label,
          value: label,
          disabled: Boolean(disabledPlatforms[label])
        })
      ),
    [disabledPlatforms]
  )

  const isPlatformRestricted = useMemo(() => {
    if (!restrictionMessage) return false
    if (!restrictedPlatform) return false
    return (
      (restrictedPlatform === 'slack' && platform === 'Slack') ||
      (restrictedPlatform === 'teams' && platform === 'Teams')
    )
  }, [restrictionMessage, restrictedPlatform, platform])

  return (
    <div className="flex flex-col gap-3">
      <NodeDropdownField
        options={dropdownOptions}
        value={platform}
        onChange={handlePlatformChange}
        onOptionBlocked={(value) => {
          if (!onRestrictionNotice) return
          const reason =
            disabledPlatforms[value as MessagingPlatform] ||
            restrictionMessage ||
            'This platform is locked on your current plan.'
          onRestrictionNotice(reason)
        }}
      />
      {validationErrors.platform && (
        <p className={errorClass}>{validationErrors.platform}</p>
      )}

      {restrictionMessage && isPlatformRestricted && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex items-start justify-between gap-2">
            <span>{restrictionMessage}</span>
            <button
              type="button"
              onClick={onUpgradeClick}
              className="rounded border border-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-400/10"
            >
              Upgrade
            </button>
          </div>
        </div>
      )}

      {platform === 'Slack' && (
        <div
          className={
            isPlatformRestricted ? 'pointer-events-none opacity-50' : ''
          }
        >
          <SlackAction
            args={childParams}
            initialDirty={childDirty}
            onChange={handleChildChange}
          />
        </div>
      )}
      {platform === 'Teams' && (
        <div
          className={
            isPlatformRestricted ? 'pointer-events-none opacity-50' : ''
          }
        >
          <TeamsAction
            args={childParams}
            initialDirty={childDirty}
            onChange={handleChildChange}
          />
        </div>
      )}
      {platform === 'Google Chat' && (
        <GoogleChatAction
          args={childParams}
          initialDirty={childDirty}
          onChange={handleChildChange}
        />
      )}
    </div>
  )
}

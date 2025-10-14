import { useState, useEffect, useMemo, useRef } from 'react'
import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import SlackAction from './Services/SlackAction'
import TeamsAction from './Services/TeamsAction'
import GoogleChatAction from './Services/GoogleChatAction'

type MessagingPlatform = 'Slack' | 'Teams' | 'Google Chat'

type PlatformParams = Record<string, any>

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
    } else {
      // Ensure non-delegated payloads don't accidentally carry mention data
      sanitized.messageType = sanitized.messageType || ''
      sanitized.mentions = Array.isArray(sanitized.mentions)
        ? sanitized.mentions
        : []
    }
  }

  return sanitized
}

interface MessagingActionProps {
  args: any
  onChange?: (args: any, nodeHasErrors: boolean, childDirty: boolean) => void
}

export default function MessagingAction({
  args,
  onChange
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

  return (
    <div className="flex flex-col gap-3">
      <NodeDropdownField
        options={['Slack', 'Teams', 'Google Chat']}
        value={platform}
        onChange={handlePlatformChange}
      />
      {validationErrors.platform && (
        <p className={errorClass}>{validationErrors.platform}</p>
      )}

      {platform === 'Slack' && (
        <SlackAction
          args={childParams}
          initialDirty={childDirty}
          onChange={handleChildChange}
        />
      )}
      {platform === 'Teams' && (
        <TeamsAction
          args={childParams}
          initialDirty={childDirty}
          onChange={handleChildChange}
        />
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

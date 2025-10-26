import { useEffect, useMemo, useRef } from 'react'

import { PLAN_RESTRICTION_MESSAGES } from './useActionNodeController'

type MessagingProvider = 'slack' | 'teams'

interface UseMessagingActionRestrictionOptions {
  provider: MessagingProvider
  isSoloPlan: boolean
  onRestrictionNotice?: (message: string) => void
  // When disabled, the hook returns no restriction and emits nothing
  enabled?: boolean
}

export interface MessagingActionRestriction {
  planRestrictionMessage: string | null
  isRestricted: boolean
}

export function useMessagingActionRestriction({
  provider,
  isSoloPlan,
  onRestrictionNotice,
  enabled = true
}: UseMessagingActionRestrictionOptions): MessagingActionRestriction {
  const planRestrictionMessage = useMemo(() => {
    if (!enabled) return null
    if (!isSoloPlan) return null
    return PLAN_RESTRICTION_MESSAGES[provider]
  }, [enabled, isSoloPlan, provider])

  const lastNoticeRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (!onRestrictionNotice) return
    if (planRestrictionMessage) {
      if (lastNoticeRef.current === planRestrictionMessage) return
      lastNoticeRef.current = planRestrictionMessage
      onRestrictionNotice(planRestrictionMessage)
    } else {
      lastNoticeRef.current = null
    }
  }, [enabled, planRestrictionMessage, onRestrictionNotice])

  return {
    planRestrictionMessage,
    isRestricted: Boolean(planRestrictionMessage)
  }
}

export default useMessagingActionRestriction

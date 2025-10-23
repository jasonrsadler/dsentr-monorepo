import { useEffect, useMemo, useRef } from 'react'

import { PLAN_RESTRICTION_MESSAGES } from './useActionNodeController'

type MessagingProvider = 'slack' | 'teams'

interface UseMessagingActionRestrictionOptions {
  provider: MessagingProvider
  isSoloPlan: boolean
  onRestrictionNotice?: (message: string) => void
}

export interface MessagingActionRestriction {
  planRestrictionMessage: string | null
  isRestricted: boolean
}

export function useMessagingActionRestriction({
  provider,
  isSoloPlan,
  onRestrictionNotice
}: UseMessagingActionRestrictionOptions): MessagingActionRestriction {
  const planRestrictionMessage = useMemo(() => {
    if (!isSoloPlan) return null
    return PLAN_RESTRICTION_MESSAGES[provider]
  }, [isSoloPlan, provider])

  const lastNoticeRef = useRef<string | null>(null)

  useEffect(() => {
    if (!onRestrictionNotice) return
    if (planRestrictionMessage) {
      if (lastNoticeRef.current === planRestrictionMessage) return
      lastNoticeRef.current = planRestrictionMessage
      onRestrictionNotice(planRestrictionMessage)
    } else {
      lastNoticeRef.current = null
    }
  }, [planRestrictionMessage, onRestrictionNotice])

  return {
    planRestrictionMessage,
    isRestricted: Boolean(planRestrictionMessage)
  }
}

export default useMessagingActionRestriction

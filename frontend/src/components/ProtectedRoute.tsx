import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/stores/auth'

type Props = {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: Props) {
  const { user, isLoading, requiresOnboarding } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (isLoading) return

    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    if (requiresOnboarding && !location.pathname.startsWith('/onboarding')) {
      navigate('/onboarding', { replace: true })
      return
    }

    if (!requiresOnboarding && location.pathname.startsWith('/onboarding')) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, isLoading, requiresOnboarding, location.pathname, navigate])

  if (isLoading) return null // or loading spinner while auth state is resolving

  // If user exists, render children
  return <>{children}</>
}

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/stores/auth'

type Props = {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: Props) {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/login', { replace: true })
    }
  }, [user, isLoading, navigate])

  if (isLoading) return null // or loading spinner while auth state is resolving

  // If user exists, render children
  return <>{children}</>
}

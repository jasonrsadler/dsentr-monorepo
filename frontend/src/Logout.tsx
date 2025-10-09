import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/stores/auth'

export default function LogoutHandler() {
  const navigate = useNavigate()
  const logout = useAuth((s) => s.logout)
  const hasLoggedOut = useRef(false)

  useEffect(() => {
    if (hasLoggedOut.current) return
    hasLoggedOut.current = true

    logout()
    navigate('/login', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

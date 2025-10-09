import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

interface NavigateButtonProps {
  to: string
  children: ReactNode
  className?: string
}

export function NavigateButton({
  to,
  children,
  className = ''
}: NavigateButtonProps) {
  return (
    <Link to={to}>
      <button
        className={`px-6 py-3 rounded font-semibold transition 
          bg-indigo-600 text-white hover:bg-indigo-500 
          dark:bg-indigo-500 dark:hover:bg-indigo-400 
          ${className}`}
      >
        {children}
      </button>
    </Link>
  )
}

import React from 'react'

interface FormButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

export function FormButton({
  children,
  className = '',
  ...props
}: FormButtonProps) {
  const baseClass =
    'w-full rounded bg-indigo-600 hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400 px-6 py-3 text-white font-semibold transition'

  return (
    <button type="submit" className={`${baseClass} ${className}`} {...props}>
      {children}
    </button>
  )
}

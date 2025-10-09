type OAuthProvider = 'google' | 'github' | 'apple'

interface OAuthButtonProps {
  provider: OAuthProvider
  onClick?: () => void
  label?: string // Optional override for the default label
}

export function OAuthButton({ provider, onClick, label }: OAuthButtonProps) {
  const defaultLabels: Record<OAuthProvider, string> = {
    google: 'Continue with Google',
    github: 'Continue with GitHub',
    apple: 'Continue with Apple'
  }

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-3 border border-zinc-300 dark:border-zinc-700 px-4 py-2 rounded bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-100 transition"
    >
      <img
        src={`/icons/${provider}.svg`}
        alt={`${provider} logo`}
        className="w-5 h-5"
      />
      {label || defaultLabels[provider]}
    </button>
  )
}

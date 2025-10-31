import SignupWithGithubImageDark from '@/assets/svg-components/SignupWithGithubImageDark'
import SignupWithGithubImageLight from '@/assets/svg-components/SignupWithGithubImageLight'

interface GithubSignupButtonProps {
  onClick?: () => void
  className?: string
}

const baseButtonClasses =
  'flex w-full items-center justify-center overflow-hidden shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 hover:brightness-95 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:brightness-125'

const svgClasses = 'h-[42px] w-full'

const GithubSignupButton = (props: GithubSignupButtonProps) => {
  const { onClick, className } = props
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        className ? `${baseButtonClasses} ${className}` : baseButtonClasses
      }
    >
      <span className="hidden w-full dark:block">
        <SignupWithGithubImageDark className={svgClasses} />
      </span>
      <span className="block w-full dark:hidden">
        <SignupWithGithubImageLight className={svgClasses} />
      </span>
    </button>
  )
}

export default GithubSignupButton

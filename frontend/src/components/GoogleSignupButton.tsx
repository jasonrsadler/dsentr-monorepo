import SignupWithGoogleButtonDark from '@/assets/svg-components/SignupWithGoogleImageDark'
import SignupWithGoogleButtonLight from '@/assets/svg-components/SignupWithGoogleImageLight'

interface GoogleSignupButtonProps {
  onClick?: () => void
  className?: string
}

const baseButtonClasses =
  'flex w-full items-center justify-center overflow-hidden shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 hover:brightness-95 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:brightness-125'

const svgClasses = 'h-[42px] w-full'

const GoogleSignupButton = (props: GoogleSignupButtonProps) => {
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
        <SignupWithGoogleButtonDark className={svgClasses} />
      </span>
      <span className="block w-full dark:hidden">
        <SignupWithGoogleButtonLight className={svgClasses} />
      </span>
    </button>
  )
}

export default GoogleSignupButton

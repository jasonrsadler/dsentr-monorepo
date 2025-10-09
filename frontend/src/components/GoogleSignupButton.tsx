import SignupWithGoogleButtonDark from '@/assets/svg-components/SignupWithGoogleImageDark'
import SignupWithGoogleButtonLight from '@/assets/svg-components/SignupWithGoogleImageLight'

interface GoogleSignupButtonProps {
  onClick?: () => void
  className?: string
}

const GoogleSignupButton = (props: GoogleSignupButtonProps) => {
  const { onClick, className } = props
  return (
    <button
      type="button"
      onClick={onClick}
      className="transition hover:brightness-90 
  dark:hover:brightness-150"
    >
      <div className="hidden dark:block">
        <SignupWithGoogleButtonDark className={className} />
      </div>
      <div className="block dark:hidden">
        <SignupWithGoogleButtonLight className={className} />
      </div>
    </button>
  )
}

export default GoogleSignupButton

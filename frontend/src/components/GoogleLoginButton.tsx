import LoginWithGoogleImageDark from '@/assets/svg-components/LoginWithGoogleImageDark'
import LoginWithGoogleImageLight from '@/assets/svg-components/LoginWithGoogleImageLight'
interface GoogleLoginButtonProps {
  onClick?: () => void
  className?: string
}

const GoogleLoginButton = (props: GoogleLoginButtonProps) => {
  const { onClick, className } = props
  return (
    <button
      type="button"
      onClick={onClick}
      className="transition hover:brightness-90 
  dark:hover:brightness-150"
    >
      <div className="hidden dark:block">
        <LoginWithGoogleImageDark className={className} />
      </div>
      <div className="block dark:hidden">
        <LoginWithGoogleImageLight className={className} />
      </div>
    </button>
  )
}

export default GoogleLoginButton

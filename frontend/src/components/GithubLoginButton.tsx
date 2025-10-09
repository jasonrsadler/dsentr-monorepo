import LoginWithGithubImageDark from '@/assets/svg-components/LoginWithGithubImageDark'
import LoginWithGithubImageLight from '@/assets/svg-components/LoginWithGithubImageLight'
interface GithubLoginButtonProps {
  onClick?: () => void
  className?: string
  text?: string
}

const GithubLoginButton = (props: GithubLoginButtonProps) => {
  const { onClick, className } = props
  return (
    <button
      type="button"
      onClick={onClick}
      className="transition hover:brightness-90 
  dark:hover:brightness-150"
    >
      <div className="hidden dark:block">
        <LoginWithGithubImageDark className={className}>
          {props.text}
        </LoginWithGithubImageDark>
      </div>
      <div className="block dark:hidden">
        <LoginWithGithubImageLight className={className}>
          {props.text}
        </LoginWithGithubImageLight>
      </div>
    </button>
  )
}

export default GithubLoginButton

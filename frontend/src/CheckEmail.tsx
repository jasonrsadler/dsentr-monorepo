import EmailIcon from '@/assets/svg-components/EmailIcon'

export default function CheckEmail() {
  return (
    <div className="max-w-md mx-auto mt-20 text-center text-white">
      <EmailIcon />
      <h1 className="text-2xl font-bold mb-4">Check Your Email</h1>
      <p className="text-gray-300">
        We've sent you a verification link. Please check your inbox to activate
        your account.
      </p>
    </div>
  )
}

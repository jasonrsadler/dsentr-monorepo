import EmailActionNode, { type EmailActionNodeProps } from './EmailActionNode'
import SMTPAction from '../Actions/Email/Services/SMTPAction'

type SmtpActionNodeProps = Omit<
  EmailActionNodeProps,
  'providerName' | 'ServiceComponent'
>

export default function SmtpActionNode(props: SmtpActionNodeProps) {
  return (
    <EmailActionNode
      {...props}
      providerName="SMTP"
      ServiceComponent={SMTPAction}
    />
  )
}

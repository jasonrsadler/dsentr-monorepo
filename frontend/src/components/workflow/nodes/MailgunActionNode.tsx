import EmailActionNode, { type EmailActionNodeProps } from './EmailActionNode'
import MailGunAction from '../Actions/Email/Services/MailGunAction'

type MailgunActionNodeProps = Omit<
  EmailActionNodeProps,
  'providerName' | 'ServiceComponent'
>

export default function MailgunActionNode(props: MailgunActionNodeProps) {
  return (
    <EmailActionNode
      {...props}
      providerName="Mailgun"
      ServiceComponent={MailGunAction}
    />
  )
}

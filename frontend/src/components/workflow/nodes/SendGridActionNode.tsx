import EmailActionNode, { type EmailActionNodeProps } from './EmailActionNode'
import SendGridAction from '../Actions/Email/Services/SendGridAction'

type SendGridActionNodeProps = Omit<
  EmailActionNodeProps,
  'providerName' | 'ServiceComponent'
>

export default function SendGridActionNode(props: SendGridActionNodeProps) {
  return (
    <EmailActionNode
      {...props}
      providerName="SendGrid"
      ServiceComponent={SendGridAction}
    />
  )
}

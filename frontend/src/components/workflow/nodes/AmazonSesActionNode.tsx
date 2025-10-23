import EmailActionNode, { type EmailActionNodeProps } from './EmailActionNode'
import AmazonSESAction from '../Actions/Email/Services/AmazonSESAction'

type AmazonSesActionNodeProps = Omit<
  EmailActionNodeProps,
  'providerName' | 'ServiceComponent'
>

export default function AmazonSesActionNode(props: AmazonSesActionNodeProps) {
  return (
    <EmailActionNode
      {...props}
      providerName="Amazon SES"
      ServiceComponent={AmazonSESAction}
    />
  )
}

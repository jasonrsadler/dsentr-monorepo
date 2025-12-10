export function SubprocessorsContent({ className }: { className?: string }) {
  return (
    <div className={className}>
      <p>
        DSentr uses the following service providers to operate the platform.
        Each receives only the minimum data required for its function.
      </p>

      <p>Hosting and infrastructure</p>
      <ul className="list-disc pl-6">
        <li>Render for application hosting and compute</li>
        <li>Neon for managed PostgreSQL storage</li>
        <li>Cloudflare for DNS and edge services</li>
      </ul>

      <p>Payments</p>
      <ul className="list-disc pl-6">
        <li>Stripe for subscription billing and payment processing</li>
      </ul>

      <p>Email delivery</p>
      <ul className="list-disc pl-6">
        <li>Mailjet for platform email delivery</li>
        <li>
          Amazon SES, SendGrid, and Mailgun for workflow email integrations
        </li>
      </ul>

      <p>Analytics and logging</p>
      <ul className="list-disc pl-6">
        <li>Sentry for error monitoring</li>
        <li>Render for system logs and operational monitoring</li>
      </ul>

      <p>
        These providers act as sub-processors under the DSentr Privacy Policy
        and follow their own security and privacy requirements.
      </p>
    </div>
  )
}

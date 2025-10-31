import type { HTMLAttributes } from 'react'
import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_TITLE,
  PRIVACY_POLICY_UPDATED_DATE
} from '@/constants/legal'

type SubSection = {
  heading: string
  paragraphs: string[]
  bullets?: string[]
}

type Section = {
  number: number
  title: string
  intro?: string[]
  subSections?: SubSection[]
  bullets?: string[]
  closing?: string[]
}

const sections: Section[] = [
  {
    number: 1,
    title: 'Information We Collect',
    subSections: [
      {
        heading: 'Account Information',
        paragraphs: [
          'When you register or sign in, we collect your name, email address, and authentication details. If you sign in through a third-party provider (e.g., Google or Microsoft), we receive basic profile information and access tokens required to operate integrations you authorize.'
        ]
      },
      {
        heading: 'Subscription and Billing Information',
        paragraphs: [
          'We use third-party payment processors (e.g., Stripe) to handle billing. Payment details are processed directly by Stripe under their security and privacy policies. Dsentr does not store credit card numbers or other payment card data.'
        ]
      },
      {
        heading: 'Workflow and Integration Data',
        paragraphs: [
          'When you connect integrations or run workflows, Dsentr processes configuration details, trigger inputs, and output data as part of normal operation. This data is retained as necessary to execute and log workflows.'
        ]
      },
      {
        heading: 'Usage and Technical Data',
        paragraphs: [
          'We collect standard technical data automatically, including IP address, browser type, device information, and usage logs. This helps us maintain performance, detect abuse, and improve the Service.'
        ]
      },
      {
        heading: 'Cookies and Analytics',
        paragraphs: [
          'The Service uses cookies for authentication and session management. We may also use analytics tools to understand feature usage and reliability. You can disable non-essential cookies in your browser.'
        ]
      }
    ]
  },
  {
    number: 2,
    title: 'How We Use Your Information',
    intro: ['We use collected information to:'],
    bullets: [
      'Operate, maintain, and improve the Service.',
      'Authenticate users and manage accounts.',
      'Process payments and manage subscriptions.',
      'Send transactional communications (e.g., billing notices, security alerts).',
      'Detect, prevent, and respond to fraud, abuse, or technical issues.',
      'Comply with legal obligations.'
    ],
    closing: ['We do not sell or rent personal data.']
  },
  {
    number: 3,
    title: 'Sharing of Information',
    intro: ['We share data only as needed to operate the Service:'],
    bullets: [
      'Service Providers: We use trusted vendors for hosting, email delivery, analytics, and payment processing.',
      'Legal Compliance: We may disclose data if required by law or to protect our legal rights.',
      'Business Transfers: If Dsentr is acquired or merged, data may transfer as part of that transaction, subject to the same privacy commitments.'
    ],
    closing: [
      'We do not share personal data with advertisers or unrelated third parties.'
    ]
  },
  {
    number: 4,
    title: 'Data Security',
    intro: [
      'We use administrative, technical, and physical safeguards to protect information.',
      'All data is encrypted in transit using TLS.',
      'Sensitive information such as OAuth tokens is stored securely and access-limited.',
      'Only authorized personnel may access production systems.',
      'No system is completely secure, but we work to minimize risk.'
    ]
  },
  {
    number: 5,
    title: 'Data Retention',
    intro: ['We retain information only as long as necessary:'],
    bullets: [
      'Account data is kept while your account is active.',
      'Workflow logs may be deleted automatically after a defined retention period.',
      'Certain records may be retained longer if required by law or for billing and audit purposes.'
    ],
    closing: [
      'When you close your account, we delete or anonymize personal data within a reasonable timeframe.'
    ]
  },
  {
    number: 6,
    title: 'International Transfers',
    intro: [
      'Dsentr is based in the United States, and all data is processed and stored on U.S. servers. If you access the Service from outside the U.S., you consent to your information being transferred and processed there under U.S. law.'
    ]
  },
  {
    number: 7,
    title: 'Your Rights',
    intro: ['Depending on your jurisdiction, you may have the right to:'],
    bullets: [
      'Access, correct, or delete your personal data.',
      'Withdraw consent to processing (by closing your account).',
      'Request a copy of your data.',
      'File a complaint with a data protection authority.'
    ],
    closing: [
      'Requests can be submitted to support@dsentr.com. We may require verification before processing any request.'
    ]
  },
  {
    number: 8,
    title: 'Data Restrictions',
    intro: [
      'The Service is not PCI-DSS compliant and must not be used to process, store, or transmit credit card information, bank details, or similar sensitive financial data. If you submit such data, you do so at your own risk.'
    ]
  },
  {
    number: 9,
    title: "Children's Privacy",
    intro: [
      'The Service is not directed at individuals under 18. We do not knowingly collect information from minors. If we become aware that a minor’s information has been collected, we will delete it promptly.'
    ]
  },
  {
    number: 10,
    title: 'Updates to This Policy',
    intro: [
      'We may update this Privacy Policy periodically. The latest version will always be posted on our website with the “Last Updated” date shown above.',
      'Material changes will be communicated by email or within the Service.',
      'Continued use after an update constitutes acceptance of the revised Policy.'
    ]
  },
  {
    number: 11,
    title: 'Contact Us',
    intro: [
      'Questions or requests regarding this Policy should be sent to:',
      'Email: support@dsentr.com'
    ]
  }
]

export function PrivacyPolicyContent({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`space-y-8 text-left text-sm leading-relaxed text-zinc-700 dark:text-zinc-200 ${className ?? ''}`}
      {...rest}
    >
      <header className="space-y-2 text-center text-zinc-800 dark:text-zinc-100">
        <h1 className="text-3xl font-bold">{PRIVACY_POLICY_TITLE}</h1>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          <p>Effective Date: {PRIVACY_POLICY_EFFECTIVE_DATE}</p>
          <p>Last Updated: {PRIVACY_POLICY_UPDATED_DATE}</p>
        </div>
      </header>

      <p>
        This Privacy Policy explains how Dsentr (“we,” “our,” or “us”) collects,
        uses, and protects your personal information when you use our
        application, website, and related services (“the Service”). By using the
        Service, you agree to the collection and use of information in
        accordance with this Policy.
      </p>

      <ol className="space-y-6">
        {sections.map((section) => (
          <li key={section.number} className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {section.number}. {section.title}
            </h2>

            {section.intro?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}

            {section.subSections?.map((subSection) => (
              <div key={subSection.heading} className="space-y-2">
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {subSection.heading}
                </h3>
                {subSection.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {subSection.bullets ? (
                  <ul className="list-disc space-y-2 pl-6">
                    {subSection.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}

            {section.bullets ? (
              <ul className="list-disc space-y-2 pl-6">
                {section.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}

            {section.closing?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </li>
        ))}
      </ol>
    </div>
  )
}

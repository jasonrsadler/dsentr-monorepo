import type { HTMLAttributes } from 'react'
import {
  TERMS_OF_SERVICE_EFFECTIVE_DATE,
  TERMS_OF_SERVICE_TITLE,
  TERMS_OF_SERVICE_UPDATED_DATE,
  TERMS_OF_SERVICE_VERSION
} from '@/constants/legal'

const sections: Array<{
  number: number
  title: string
  body: Array<string>
  bullets?: string[]
}> = [
    {
      number: 1,
      title: 'Agreement to Terms',
      body: [
        'By accessing or using the DSentr application (“the Service”), you agree to these Terms of Service (“Terms”) and our Privacy Policy. If you do not agree, do not use the Service.'
      ]
    },
    {
      number: 2,
      title: 'Eligibility',
      body: [
        'You must be at least 18 years old and legally capable of entering into a binding agreement. If you use the Service on behalf of a company or organization, you represent that you have the authority to bind that entity to these Terms.'
      ]
    },
    {
      number: 3,
      title: 'Accounts',
      body: [
        'You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account. Notify us immediately of any unauthorized use. DSentr is not liable for any loss resulting from unauthorized access to your account.'
      ]
    },
    {
      number: 4,
      title: 'Acceptable Use',
      body: [
        'You agree not to use the Service for any unlawful, harmful, or abusive purpose. Specifically, you must not:'
      ],
      bullets: [
        'Attempt to probe, scan, or test the vulnerability of any system or network.',
        'Interfere with, disrupt, or degrade the performance of the Service (including denial-of-service attacks).',
        'Use the Service to distribute malware, spam, or unauthorized advertising.',
        'Engage in fraud, impersonation, or any deceptive or misleading activity.',
        'Attempt to gain unauthorized access to accounts, data, or systems.',
        'Reverse-engineer or decompile any part of the Service.',
        'Use the Service to violate the rights, property, or privacy of others or to break any applicable law or regulation.'
      ]
    },
    {
      number: 5,
      title: 'Data Restrictions and PCI Disclaimer',
      body: [
        'The Service is not designed or certified for processing, storing, or transmitting payment card data or any information governed by PCI DSS. You agree not to use the Service to handle, transmit, or store:',
        'DSentr disclaims all responsibility for any exposure, loss, or misuse of such data if you disregard this restriction.'
      ],
      bullets: [
        'Credit card or debit card numbers.',
        'Bank account information or government-issued identification numbers.',
        'Sensitive health, financial, or biometric data unless explicitly authorized by DSentr in writing.'
      ]
    },
    {
      number: 6,
      title: 'Ownership and Intellectual Property',
      body: [
        'All software, code, and materials provided through the Service remain the property of DSentr and its licensors. You retain ownership of your data and workflows created within the Service. You grant DSentr a limited, revocable license to process, host, and display your data solely to operate and maintain the Service.'
      ]
    },
    {
      number: 7,
      title: 'Subscriptions and Payments',
      body: [
        'Subscription plans, pricing, and billing cycles are listed on our website.',
        'All payments are non-refundable except where required by law.',
        'We may change pricing or plan features with reasonable notice.',
        'Continued use after any change constitutes acceptance of the new terms.',
        'Failure to pay may result in suspension or termination of your account.',
        'If you do not accept updated Terms before your next renewal, your subscription will not automatically renew, and your access will end at the conclusion of your current billing period. Subscriptions continue to auto-renew until you cancel or fail to accept new Terms after login.'
      ]
    },
    {
      number: 8,
      title: 'Termination',
      body: [
        'You may close your account at any time through your account settings or by contacting us. We may suspend or terminate your account if you violate these Terms or for any reason upon reasonable notice. Upon termination, your right to use the Service ends immediately, and we may delete your stored data after a reasonable period.'
      ]
    },
    {
      number: 9,
      title: 'Disclaimer of Warranties',
      body: [
        'The Service is provided “as is” and “as available” without warranties of any kind, whether express, implied, or statutory. DSentr makes no warranty that the Service will be uninterrupted, error-free, secure, or that your data will not be lost or corrupted.'
      ]
    },
    {
      number: 10,
      title: 'Limitation of Liability',
      body: [
        'To the maximum extent permitted by law, DSentr and its affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, data, or goodwill, arising from your use of or inability to use the Service, even if advised of the possibility of such damages. Our total liability for any claim relating to the Service shall not exceed the amount you paid to DSentr during the twelve (12) months preceding the claim.'
      ]
    },
    {
      number: 11,
      title: 'Indemnification',
      body: [
        'You agree to defend, indemnify, and hold harmless DSentr, its employees, contractors, and affiliates from any claim, damage, liability, or expense (including attorney’s fees) arising out of your use of the Service or violation of these Terms.'
      ]
    },
    {
      number: 12,
      title: 'Modifications to the Service or Terms',
      body: [
        'We may modify or discontinue the Service (in whole or in part) at any time.',
        'We may update these Terms periodically; the most current version will always be posted on our website. Updated Terms become effective upon posting and apply at the user’s next login or continued use of the Service. Continued use after changes become effective constitutes acceptance of the revised Terms.'
      ]
    },
    {
      number: 13,
      title: 'Governing Law',
      body: [
        'These Terms are governed by the laws of the Commonwealth of Virginia, without regard to conflict-of-law principles. Any dispute shall be resolved exclusively in the state or federal courts located in Virginia Beach, Virginia.'
      ]
    },
    {
      number: 14,
      title: 'Severability',
      body: [
        'If any provision of these Terms is held invalid, the remaining provisions remain in full force and effect.'
      ]
    },
    {
      number: 15,
      title: 'Entire Agreement',
      body: [
        'These Terms, together with the Privacy Policy, constitute the entire agreement between you and DSentr regarding the Service and supersede any prior agreements or understandings.'
      ]
    },
    {
      number: 16,
      title: 'Contact',
      body: [
        'For questions or notices regarding these Terms, contact:',
        'Email: support@dsentr.com'
      ]
    }
  ]

export function TermsOfServiceContent({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`space-y-8 text-left text-sm leading-relaxed text-zinc-700 dark:text-zinc-200 ${className ?? ''}`}
      {...rest}
    >
      <header className="space-y-2 text-center text-zinc-800 dark:text-zinc-100">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-300">
          Version {TERMS_OF_SERVICE_VERSION}
        </p>
        <h1 className="text-3xl font-bold">{TERMS_OF_SERVICE_TITLE}</h1>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          <p>Effective Date: {TERMS_OF_SERVICE_EFFECTIVE_DATE}</p>
          <p>Last Updated: {TERMS_OF_SERVICE_UPDATED_DATE}</p>
        </div>
      </header>

      <ol className="space-y-6">
        {sections.map((section) => (
          <li key={section.number} className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {section.number}. {section.title}
            </h2>
            {section.body.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
            {section.bullets ? (
              <ul className="list-disc space-y-2 pl-6">
                {section.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

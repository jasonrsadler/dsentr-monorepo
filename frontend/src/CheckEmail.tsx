import EmailIcon from '@/assets/svg-components/EmailIcon'
import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { BrandHero } from '@/components/marketing/BrandHero'

export default function CheckEmail() {
  return (
    <>
      <MetaTags
        title="Check your inbox – Dsentr"
        description="We sent you a secure link to finish setting up your Dsentr account."
      />
      <MarketingShell maxWidthClassName="max-w-3xl">
        <div className="space-y-12 text-center">
          <BrandHero
            title="Confirm your email"
            description="We just sent a secure link to your inbox. Open it from the same device to continue with setup."
            kicker="Next step"
          />

          <div className="flex flex-col items-center gap-6 rounded-2xl border border-zinc-200/60 bg-white/70 p-10 text-center shadow-sm dark:border-white/10 dark:bg-zinc-900/70">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <EmailIcon />
            </span>
            <p className="max-w-xl text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
              Didn&apos;t receive anything? Check your spam folder or request a
              new link from the login page. For security, the link expires in 15
              minutes.
            </p>
            <a
              href="mailto:"
              className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500"
            >
              Open email app
            </a>
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { PrivacyPolicyContent } from '@/components/legal/PrivacyPolicyContent'

export default function PrivacyPolicyPage() {
  return (
    <>
      <MetaTags
        title="Privacy Policy – Dsentr"
        description="Learn how Dsentr collects, uses, and protects your personal information across our application and related services."
      />
      <MarketingShell maxWidthClassName="max-w-5xl">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-3xl border border-zinc-200/60 bg-white/80 p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
            <PrivacyPolicyContent className="themed-scroll max-h-[70vh] overflow-y-auto pr-2" />
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { TermsOfServiceContent } from '@/components/legal/TermsOfServiceContent'

export default function TermsOfServicePage() {
  return (
    <>
      <MetaTags
        title="Terms of Service – Dsentr"
        description="Review the Dsentr Terms of Service, including eligibility, acceptable use, and subscription policies."
      />
      <MarketingShell maxWidthClassName="max-w-5xl">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-3xl border border-zinc-200/60 bg-white/80 p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
            <TermsOfServiceContent className="themed-scroll max-h-[70vh] overflow-y-auto pr-2" />
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

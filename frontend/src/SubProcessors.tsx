import { MetaTags } from '@/components/MetaTags'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { SubprocessorsContent } from './SubprocessorsContent'

export default function SubprocessorsPage() {
  return (
    <>
      <MetaTags
        title="Sub-Processors - DSentr"
        description="List of DSentr service providers acting as sub-processors."
      />
      <MarketingShell compact maxWidthClassName="max-w-5xl">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-3xl border border-zinc-200/60 bg-white/80 p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
            <SubprocessorsContent className="themed-scroll max-h-[70vh] overflow-y-auto pr-2" />
          </div>
        </div>
      </MarketingShell>
    </>
  )
}

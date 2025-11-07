import { useEffect, useState } from 'react'
import {
  getPrivacyPreference,
  setPrivacyPreference
} from '@/lib/accountSettingsApi'

export default function PrivacyTab() {
  const [allow, setAllow] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    getPrivacyPreference()
      .then((res) => {
        if (!active) return
        setAllow(Boolean(res.allow))
        setError(null)
      })
      .catch(() => {
        if (!active) return
        setAllow(true)
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSave() {
    try {
      setSaving(true)
      setError(null)
      setSaved(false)
      await setPrivacyPreference(allow)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preference')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Privacy
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Control how your workflow configurations may be used to improve the
          DSentr experience.
        </p>
      </header>

      <section>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={allow}
            onChange={(e) => setAllow(e.target.checked)}
            disabled={loading || saving}
          />
          <div className="space-y-1">
            <div className="font-medium">Help improve DSentr</div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Allow us to analyze your workflow setups to discover patterns and
              enhance product features. If you treat your workflows as trade
              secrets, uncheck this.
            </p>
          </div>
        </label>
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            onClick={handleSave}
            disabled={loading || saving}
          >
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
          {saved && <span className="text-xs text-emerald-600">Saved</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </section>
    </div>
  )
}

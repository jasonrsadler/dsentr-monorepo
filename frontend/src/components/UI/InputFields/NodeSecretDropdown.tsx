import { useMemo, useState } from 'react'
import { useSecrets } from '@/contexts/SecretsContext'

interface NodeSecretDropdownProps {
  group: string
  service: string
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

interface SecretOption {
  name: string
  value: string
}

function maskLabel(value: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const visible = Math.min(trimmed.length, 6)
  const masked = '•'.repeat(visible)
  return `${masked}${trimmed.length > visible ? '…' : ''}`
}

export default function NodeSecretDropdown({
  group,
  service,
  value,
  onChange,
  placeholder = 'Select secret',
  disabled = false
}: NodeSecretDropdownProps) {
  const { secrets, loading, saveSecret } = useSecrets()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [valueDraft, setValueDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo<SecretOption[]>(() => {
    const serviceEntries = secrets[group]?.[service] ?? {}
    return Object.entries(serviceEntries).map(([name, entry]) => ({
      name,
      value: entry?.value ?? ''
    }))
  }, [secrets, group, service])

  const selectedOption = useMemo(
    () => options.find((option) => option.value === (value ?? '')),
    [options, value]
  )

  const displayLabel = useMemo(() => {
    if (selectedOption) return selectedOption.name
    if (value) return `Custom value (${maskLabel(value) || 'set'})`
    if (loading) return 'Loading secrets…'
    return placeholder
  }, [selectedOption, value, loading, placeholder])

  const handleSelect = (option: SecretOption) => {
    if (option.value === value) {
      setOpen(false)
      return
    }
    onChange(option.value)
    setOpen(false)
  }

  const beginCreate = () => {
    setOpen(false)
    setError(null)
    setNameDraft('')
    setValueDraft('')
    setCreating(true)
  }

  const handleSave = async () => {
    const trimmedName = nameDraft.trim()
    const trimmedValue = valueDraft.trim()
    if (!trimmedName) {
      setError('Please provide a name for this secret.')
      return
    }
    if (!trimmedValue) {
      setError('Please provide a secret value.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      await saveSecret(group, service, trimmedName, trimmedValue)
      onChange(trimmedValue)
      setCreating(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to save secret. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  const effectiveDisabled = disabled || (loading && options.length === 0)

  return (
    <div className="text-xs">
      <div className="relative inline-block w-full">
        <button
          type="button"
          onClick={() => {
            if (effectiveDisabled) return
            setOpen((prev) => !prev)
          }}
          className="relative w-full text-left px-2 py-1 border rounded bg-zinc-50 dark:bg-zinc-800"
          disabled={effectiveDisabled}
        >
          {displayLabel}
          <svg
            className={`absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {open && (
          <ul className="absolute z-20 w-full mt-1 border rounded bg-white dark:bg-zinc-900 shadow-md max-h-40 overflow-auto themed-scroll">
            {options.length === 0 && (
              <li className="px-2 py-2 text-zinc-500 dark:text-zinc-400 text-[11px]">
                No secrets saved yet.
              </li>
            )}
            {options.map((option) => (
              <li
                key={option.name}
                onClick={() => handleSelect(option)}
                className="px-2 py-1 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-[11px] text-zinc-900 dark:text-zinc-100">
                    {option.name}
                  </span>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 tracking-widest">
                    {maskLabel(option.value)}
                  </span>
                </div>
              </li>
            ))}
            <li className="border-t border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={beginCreate}
                className="w-full text-left px-2 py-1 text-[11px] text-blue-600 hover:bg-zinc-200 dark:text-blue-400 dark:hover:bg-zinc-700"
              >
                + Create new secret
              </button>
            </li>
          </ul>
        )}
      </div>

      {creating && (
        <div className="mt-2 space-y-2 border border-dashed border-zinc-300 dark:border-zinc-600 rounded p-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">
              Secret name
            </label>
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
              placeholder="e.g. Primary Token"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">
              Secret value
            </label>
            <input
              type="password"
              value={valueDraft}
              onChange={(e) => setValueDraft(e.target.value)}
              className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
              placeholder="Enter value"
            />
          </div>
          {error && (
            <p className="text-[10px] text-red-500" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-2 py-1 text-[11px] rounded bg-blue-600 text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save & Select'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-2 py-1 text-[11px] text-zinc-600 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

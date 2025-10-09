type Props = {
  disallowDuplicateNames: boolean
  onToggleDuplicateNames: (v: boolean) => void
}

export default function PreferencesTab({ disallowDuplicateNames, onToggleDuplicateNames }: Props) {
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={disallowDuplicateNames}
          onChange={(e) => onToggleDuplicateNames(e.target.checked)}
        />
        <span>Disallow duplicate workflow names</span>
      </label>
      <p className="text-sm text-zinc-500">When creating a new workflow, a number will be appended to ensure uniqueness.</p>
    </div>
  )
}


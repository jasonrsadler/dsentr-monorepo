interface NodeCheckBoxFieldProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  children?: React.ReactNode;
}

export default function NodeCheckBoxField({ children, checked = true, onChange }: NodeCheckBoxFieldProps) {
  const inputClass = "flex items-center gap-1 text-xs"

  return (
    <label className={inputClass}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      {children}
    </label>
  )
}

interface NodeInputFieldProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function NodeInputField({ type = "text", placeholder = "", value = "", onChange, className }: NodeInputFieldProps) {
  const inputClass =
    "text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-zinc-500 nodrag";

  return (
    <input
      type={type}
      placeholder={placeholder}
      className={className ?? inputClass}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  )
}

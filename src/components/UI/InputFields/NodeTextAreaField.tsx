interface NodeInputFieldProps {
  rows?: number;
  value?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

export default function NodeTextAreaField({ rows = 2, placeholder = "", value = "", onChange }: NodeInputFieldProps) {
  const inputClass =
    "text-xs p-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-zinc-500 nodrag";

  return (
    <textarea
      rows={rows}
      placeholder={placeholder}
      className={inputClass}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  )
}

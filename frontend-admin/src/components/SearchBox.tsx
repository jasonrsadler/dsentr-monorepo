import { useState } from "react";

interface SearchBoxProps {
  placeholder?: string;
  onSearch: (value: string) => void;
  defaultValue?: string;
}

export default function SearchBox({
  placeholder,
  onSearch,
  defaultValue = "",
}: SearchBoxProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="flex items-center gap-2">
      <input
        className="w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-accent focus:outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          onSearch(v);
        }}
      />
    </div>
  );
}

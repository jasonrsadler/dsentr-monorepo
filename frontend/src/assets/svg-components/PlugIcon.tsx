export default function PlugIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="w-10 h-10 text-indigo-600 dark:text-indigo-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 2v4m6-4v4" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 6h10v6a2 2 0 01-2 2H9a2 2 0 01-2-2V6z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14v6" />
    </svg>
  )
}

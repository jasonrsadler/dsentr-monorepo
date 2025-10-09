export default function ClockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="w-10 h-10 text-indigo-600 dark:text-indigo-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
    </svg>
  )
}

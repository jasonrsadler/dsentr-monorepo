export default function ShieldIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="w-10 h-10 text-indigo-600 dark:text-indigo-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

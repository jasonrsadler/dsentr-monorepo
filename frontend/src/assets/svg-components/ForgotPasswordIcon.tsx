export default function ForgotPasswordIcon(
  props: React.SVGProps<SVGSVGElement>
) {
  return (
    <svg
      className="mx-auto mb-4 h-16 w-16 text-indigo-600 dark:text-indigo-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

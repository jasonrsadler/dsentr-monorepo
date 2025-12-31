export default function NotionIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="8" y="8" width="48" height="48" rx="6" fill="#111111" />
      <path d="M22 44V20h5l15 20V20h4v24h-5L26 24v20h-4z" fill="#FFFFFF" />
    </svg>
  )
}

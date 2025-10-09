interface Props {
  className?: string
}

export const DsentrLogo: React.FC<Props> = ({ className }) => {
  return (
    <div className="text-zinc-900 dark:text-zinc-100">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="30"
        height="30"
        viewBox="0 0 200 200"
        fill="none"
        className={className}
        style={{ marginTop: '-3px' }}
      >
        <style>
          {`
            .square { fill: currentColor; rx: 4; }
            .line { stroke: currentColor; stroke-width: 8; }
          `}
        </style>

        {/* Top row squares */}
        <rect x="20" y="20" width="32" height="32" className="square" />
        <rect x="84" y="20" width="32" height="32" className="square" />
        <rect x="148" y="20" width="32" height="32" className="square" />

        {/* Second row squares */}
        <rect x="20" y="84" width="32" height="32" className="square" />
        <rect x="84" y="84" width="32" height="32" className="square" />
        <rect x="148" y="84" width="32" height="32" className="square" />

        {/* Third row squares */}
        <rect x="20" y="148" width="32" height="32" className="square" />
        <rect x="84" y="148" width="32" height="32" className="square" />
        <rect x="148" y="148" width="32" height="32" className="square" />

        {/* Horizontal connections on top row */}
        <line x1="52" y1="36" x2="84" y2="36" className="line" />
        <line x1="116" y1="36" x2="148" y2="36" className="line" />

        {/* Vertical connection on first column */}
        <line x1="36" y1="52" x2="36" y2="84" className="line" />
      </svg>
    </div>
  )
}

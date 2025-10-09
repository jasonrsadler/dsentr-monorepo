export function WorkflowIllustration() {
  return (
    <svg
      viewBox="0 0 400 640"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-[28rem] md:max-w-none h-auto"
    >
      <style>
        {`
          .fade-in {
            opacity: 0;
            animation: fadeIn 1s ease-out forwards;
          }
          .pulse {
            animation: pulse 2s infinite;
          }
          .line {
            stroke-dasharray: 1000;
            stroke-dashoffset: 1000;
            animation: dash 1.5s ease forwards;
          }

          .delay-1 { animation-delay: 0.5s; }
          .delay-2 { animation-delay: 1.5s; }
          .delay-3 { animation-delay: 2.5s; }
          .delay-4 { animation-delay: 3.5s; }
          .delay-5 { animation-delay: 4.5s; }

          @keyframes fadeIn {
            to { opacity: 1; }
          }
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
          @keyframes dash {
            to { stroke-dashoffset: 0; }
          }

          text {
            font-family: 'Inter', sans-serif;
          }
        `}
      </style>

      {/* Trigger */}
      <rect
        x="130"
        y="60"
        width="140"
        height="60"
        rx="12"
        className="fill-indigo-500 pulse"
      />
      <text x="200" y="95" textAnchor="middle" fill="white" fontSize="16">
        Trigger
      </text>

      {/* Line to Action */}
      <line
        x1="200"
        y1="120"
        x2="200"
        y2="160"
        stroke="#94a3b8"
        strokeWidth="3"
        className="line delay-1"
      />
      <polygon
        points="195,160 205,160 200,170"
        fill="#94a3b8"
        className="fade-in delay-1"
      />

      {/* Action */}
      <rect
        x="130"
        y="180"
        width="140"
        height="60"
        rx="12"
        className="fill-indigo-600 fade-in delay-1"
      />
      <text x="200" y="215" textAnchor="middle" fill="white" fontSize="16">
        Action
      </text>

      {/* Line to Decision */}
      <line
        x1="200"
        y1="240"
        x2="200"
        y2="280"
        stroke="#94a3b8"
        strokeWidth="3"
        className="line delay-2"
      />
      <polygon
        points="195,280 205,280 200,290"
        fill="#94a3b8"
        className="fade-in delay-2"
      />

      {/* Decision */}
      <rect
        x="130"
        y="300"
        width="140"
        height="60"
        rx="12"
        className="fill-amber-500 fade-in delay-2"
      />
      <text x="200" y="335" textAnchor="middle" fill="white" fontSize="16">
        Decision?
      </text>

      {/* Branch Yes */}
      <line
        x1="200"
        y1="360"
        x2="120"
        y2="400"
        stroke="#94a3b8"
        strokeWidth="3"
        className="line delay-3"
      />
      <polygon
        points="115,400 125,400 120,410"
        fill="#94a3b8"
        className="fade-in delay-3"
      />
      <rect
        x="60"
        y="420"
        width="120"
        height="50"
        rx="10"
        className="fill-emerald-500 fade-in delay-3"
      />
      <text x="120" y="450" textAnchor="middle" fill="white" fontSize="14">
        Yes: Send Email
      </text>

      {/* Branch No */}
      <line
        x1="200"
        y1="360"
        x2="280"
        y2="400"
        stroke="#94a3b8"
        strokeWidth="3"
        className="line delay-3"
      />
      <polygon
        points="275,400 285,400 280,410"
        fill="#94a3b8"
        className="fade-in delay-3"
      />
      <rect
        x="220"
        y="420"
        width="120"
        height="50"
        rx="10"
        className="fill-rose-500 fade-in delay-3"
      />
      <text x="280" y="450" textAnchor="middle" fill="white" fontSize="14">
        No: Slack Alert
      </text>

      {/* Loop line from Yes to Trigger */}
      <path
        d="M120 470 C100 520, 100 540, 200 540"
        fill="none"
        stroke="#94a3b8"
        strokeWidth="3"
        className="line delay-4"
      />
      <polygon
        points="195,540 205,540 200,550"
        fill="#94a3b8"
        className="fade-in delay-4"
      />

      {/* Footer Text */}
      <text
        x="200"
        y="620"
        textAnchor="middle"
        fill="currentColor"
        fontSize="18"
        className="fade-in delay-5"
      >
        Build. Connect. Automate.
      </text>
    </svg>
  )
}

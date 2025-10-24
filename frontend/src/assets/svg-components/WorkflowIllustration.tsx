import { useMemo } from 'react'

import { useTheme } from '@/hooks/useTheme'

export function WorkflowIllustration() {
  const { isDark } = useTheme()

  const palette = useMemo(
    () =>
      isDark
        ? {
            backgroundStops: [
              { offset: '0%', color: '#0f172a', opacity: 1 },
              { offset: '60%', color: '#1e1b4b', opacity: 0.85 },
              { offset: '100%', color: '#020617', opacity: 0.65 }
            ],
            connectorStops: [
              { offset: '0%', color: '#818cf8' },
              { offset: '50%', color: '#06b6d4' },
              { offset: '100%', color: '#22c55e' }
            ],
            cardHeaderStops: [
              { offset: '0%', color: '#4338ca' },
              { offset: '100%', color: '#7c3aed' }
            ],
            cardShadow: { color: '#020617', opacity: 0.4 },
            floatingShadow: { color: '#020617', opacity: 0.35 },
            cardFill: '#0b1120',
            cardHeaderLabel: '#a5b4fc',
            cardHeaderTitle: '#f9fafb',
            bodyText: '#e2e8f0',
            bodySubtext: '#94a3b8',
            floatingAccents: {
              leftLarge: '#1e293b',
              rightLarge: '#312e81',
              smallPurple: '#7c3aed',
              smallSky: '#0ea5e9',
              smallGreen: '#22c55e'
            },
            glowAccents: {
              left: '#818cf8',
              midLeft: '#38bdf8',
              center: '#a855f7',
              midRight: '#06b6d4',
              right: '#22c55e'
            },
            cards: {
              trigger: {
                fill: '#1e1b4b',
                text: '#c7d2fe',
                icon: '#6366f1',
                check: '#e2e8f0'
              },
              transform: {
                fill: '#022c22',
                text: '#5eead4',
                icon: '#14b8a6',
                accent: '#5eead4',
                dot: '#f0fdfa'
              },
              branch: {
                fill: '#292524',
                text: '#fcd34d',
                stroke: '#fb923c'
              },
              notify: {
                fill: '#064e3b',
                text: '#bbf7d0',
                icon: '#10b981',
                accent: '#bbf7d0'
              }
            }
          }
        : {
            backgroundStops: [
              { offset: '0%', color: '#eef2ff', opacity: 1 },
              { offset: '60%', color: '#e0e7ff', opacity: 0.9 },
              { offset: '100%', color: '#c7d2fe', opacity: 0.4 }
            ],
            connectorStops: [
              { offset: '0%', color: '#6366f1' },
              { offset: '50%', color: '#22d3ee' },
              { offset: '100%', color: '#10b981' }
            ],
            cardHeaderStops: [
              { offset: '0%', color: '#6366f1' },
              { offset: '100%', color: '#8b5cf6' }
            ],
            cardShadow: { color: '#312e81', opacity: 0.12 },
            floatingShadow: { color: '#1e293b', opacity: 0.1 },
            cardFill: '#ffffff',
            cardHeaderLabel: '#c7d2fe',
            cardHeaderTitle: '#ffffff',
            bodyText: '#1e293b',
            bodySubtext: '#475569',
            floatingAccents: {
              leftLarge: '#e0f2fe',
              rightLarge: '#ede9fe',
              smallPurple: '#a855f7',
              smallSky: '#38bdf8',
              smallGreen: '#34d399'
            },
            glowAccents: {
              left: '#6366f1',
              midLeft: '#38bdf8',
              center: '#c4b5fd',
              midRight: '#22d3ee',
              right: '#34d399'
            },
            cards: {
              trigger: {
                fill: '#eef2ff',
                text: '#312e81',
                icon: '#6366f1',
                check: '#ffffff'
              },
              transform: {
                fill: '#ecfeff',
                text: '#0f172a',
                icon: '#14b8a6',
                accent: '#ffffff',
                dot: '#ffffff'
              },
              branch: {
                fill: '#fef3c7',
                text: '#92400e',
                stroke: '#fb923c'
              },
              notify: {
                fill: '#dcfce7',
                text: '#14532d',
                icon: '#10b981',
                accent: '#ffffff'
              }
            }
          },
    [isDark]
  )

  return (
    <svg
      viewBox="0 0 400 640"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-[28rem] md:max-w-none h-auto"
    >
      <defs>
        <radialGradient id="bgGradient" cx="50%" cy="30%" r="70%">
          {palette.backgroundStops.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={stop.color}
              stopOpacity={stop.opacity}
            />
          ))}
        </radialGradient>
        <linearGradient
          id="connectorGradient"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          {palette.connectorStops.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={stop.color}
            />
          ))}
        </linearGradient>
        <linearGradient
          id="cardHeaderGradient"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="0%"
        >
          {palette.cardHeaderStops.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={stop.color}
            />
          ))}
        </linearGradient>
        <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow
            dx="0"
            dy="12"
            stdDeviation="18"
            floodColor={palette.cardShadow.color}
            floodOpacity={palette.cardShadow.opacity}
          />
        </filter>
        <filter
          id="floatingShadow"
          x="-30%"
          y="-30%"
          width="160%"
          height="200%"
        >
          <feDropShadow
            dx="0"
            dy="20"
            stdDeviation="24"
            floodColor={palette.floatingShadow.color}
            floodOpacity={palette.floatingShadow.opacity}
          />
        </filter>
      </defs>

      <style>
        {`
          .fade-in {
            opacity: 0;
            animation: fadeIn 0.9s ease forwards;
          }
          .fade-in.delay-1 { animation-delay: 0.4s; }
          .fade-in.delay-2 { animation-delay: 0.8s; }
          .fade-in.delay-3 { animation-delay: 1.2s; }
          .fade-in.delay-4 { animation-delay: 1.6s; }
          .float {
            animation: float 6s ease-in-out infinite;
          }
          .float.delay {
            animation-delay: 2s;
          }
          .dash {
            stroke-dasharray: 6 12;
            animation: dash 8s linear infinite;
          }
          .pulse {
            transform-origin: center;
            animation: pulse 2.6s ease-in-out infinite;
          }
          .glow {
            opacity: 0.65;
            animation: glow 4s ease-in-out infinite;
          }

          text, tspan {
            font-family: 'Inter', sans-serif;
            font-weight: 600;
          }

          @keyframes fadeIn {
            to { opacity: 1; }
          }

          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-12px); }
          }

          @keyframes dash {
            to { stroke-dashoffset: -360; }
          }

          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 0.75; }
            50% { transform: scale(1.06); opacity: 1; }
          }

          @keyframes glow {
            0%, 100% { opacity: 0.35; }
            50% { opacity: 0.75; }
          }
        `}
      </style>

      <rect
        x="0"
        y="0"
        width="400"
        height="640"
        fill="url(#bgGradient)"
        rx="32"
      />

      <g filter="url(#floatingShadow)">
        <circle
          cx="70"
          cy="120"
          r="34"
          fill={palette.floatingAccents.leftLarge}
          className="float"
        />
        <circle
          cx="330"
          cy="160"
          r="24"
          fill={palette.floatingAccents.rightLarge}
          className="float delay"
        />
        <circle
          cx="320"
          cy="90"
          r="12"
          fill={palette.floatingAccents.smallPurple}
          opacity="0.4"
          className="pulse"
        />
        <circle
          cx="90"
          cy="210"
          r="10"
          fill={palette.floatingAccents.smallSky}
          opacity="0.4"
          className="pulse"
        />
        <circle
          cx="340"
          cy="250"
          r="8"
          fill={palette.floatingAccents.smallGreen}
          opacity="0.4"
          className="pulse"
        />
      </g>

      <g filter="url(#cardShadow)">
        <rect
          x="48"
          y="160"
          width="304"
          height="330"
          rx="28"
          fill={palette.cardFill}
          className="fade-in"
        />
        <rect
          x="48"
          y="160"
          width="304"
          height="88"
          rx="28"
          fill="url(#cardHeaderGradient)"
          className="fade-in"
        />
        <text
          x="70"
          y="210"
          fontSize="16"
          fill={palette.cardHeaderLabel}
          className="fade-in delay-1"
        >
          Workflow Overview
        </text>
        <text
          x="70"
          y="238"
          fontSize="28"
          fill={palette.cardHeaderTitle}
          className="fade-in delay-1"
        >
          Automate in Minutes
        </text>
      </g>

      <g className="fade-in delay-2">
        <rect
          x="92"
          y="280"
          width="124"
          height="64"
          rx="18"
          fill={palette.cards.trigger.fill}
        />
        <text
          x="154"
          y="316"
          textAnchor="middle"
          fontSize="16"
          fill={palette.cards.trigger.text}
        >
          Trigger
        </text>
        <circle cx="118" cy="300" r="10" fill={palette.cards.trigger.icon} />
        <path
          d="M114 300 l6 6 10-12"
          stroke={palette.cards.trigger.check}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
      </g>

      <g className="fade-in delay-2">
        <rect
          x="214"
          y="280"
          width="124"
          height="64"
          rx="18"
          fill={palette.cards.transform.fill}
        />
        <text
          x="276"
          y="316"
          textAnchor="middle"
          fontSize="16"
          fill={palette.cards.transform.text}
        >
          Transform Data
        </text>
        <circle cx="240" cy="300" r="10" fill={palette.cards.transform.icon} />
        <path
          d="M236 300 l8 8"
          stroke={palette.cards.transform.accent}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="250" cy="300" r="4" fill={palette.cards.transform.dot} />
      </g>

      <g className="fade-in delay-3">
        <rect
          x="92"
          y="372"
          width="124"
          height="64"
          rx="18"
          fill={palette.cards.branch.fill}
        />
        <text
          x="154"
          y="408"
          textAnchor="middle"
          fontSize="16"
          fill={palette.cards.branch.text}
        >
          Branch Logic
        </text>
        <path
          d="M124 392 h20 l6 8 -6 8 h-20"
          stroke={palette.cards.branch.stroke}
          strokeWidth="2.6"
          fill="none"
          strokeLinejoin="round"
        />
      </g>

      <g className="fade-in delay-3">
        <rect
          x="214"
          y="372"
          width="124"
          height="64"
          rx="18"
          fill={palette.cards.notify.fill}
        />
        <text
          x="276"
          y="408"
          textAnchor="middle"
          fontSize="16"
          fill={palette.cards.notify.text}
        >
          Notify Team
        </text>
        <circle cx="240" cy="392" r="10" fill={palette.cards.notify.icon} />
        <path
          d="M236 392 h8"
          stroke={palette.cards.notify.accent}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M240 392 l8 8"
          stroke={palette.cards.notify.accent}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </g>

      <path
        d="M154 312 C190 312 190 392 226 392"
        stroke="url(#connectorGradient)"
        strokeWidth="4"
        fill="none"
        className="dash fade-in delay-2"
        strokeLinecap="round"
      />
      <path
        d="M276 312 C240 312 240 392 206 392"
        stroke="url(#connectorGradient)"
        strokeWidth="4"
        fill="none"
        className="dash fade-in delay-3"
        strokeLinecap="round"
      />
      <path
        d="M154 436 C154 464 214 464 214 436"
        stroke="url(#connectorGradient)"
        strokeWidth="4"
        fill="none"
        className="dash fade-in delay-4"
        strokeLinecap="round"
      />

      <g className="fade-in delay-4">
        <circle
          cx="132"
          cy="476"
          r="10"
          fill={palette.glowAccents.left}
          className="glow"
        />
        <circle
          cx="172"
          cy="500"
          r="6"
          fill={palette.glowAccents.midLeft}
          className="glow"
        />
        <circle
          cx="214"
          cy="488"
          r="12"
          fill={palette.glowAccents.center}
          className="glow"
        />
        <circle
          cx="254"
          cy="504"
          r="8"
          fill={palette.glowAccents.midRight}
          className="glow"
        />
        <circle
          cx="292"
          cy="484"
          r="10"
          fill={palette.glowAccents.right}
          className="glow"
        />
      </g>

      <text
        x="200"
        y="564"
        textAnchor="middle"
        fontSize="18"
        fill={palette.bodyText}
        className="fade-in delay-4"
      >
        Build intelligent workflows faster.
      </text>
      <text
        x="200"
        y="592"
        textAnchor="middle"
        fontSize="14"
        fill={palette.bodySubtext}
        className="fade-in delay-4"
      >
        Connect apps, branch logic, and notify teams automatically.
      </text>
    </svg>
  )
}

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const SQUARES = 12
const CENTER = 100
const RADIUS = 60

export default function ModularAnimation() {
  const [flattened, setFlattened] = useState(false)

  useEffect(() => {
    const cycle = () => {
      setFlattened(true)
      setTimeout(() => setFlattened(false), 5000) // Show grid for 5s, then return to globe
    }

    const interval = setInterval(cycle, 11000) // 6s orbit + 5s grid
    cycle() // start immediately

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="absolute inset-0 w-full h-full -z-10 overflow-hidden pointer-events-none modular-animation-wrapper">
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full text-zinc-400 dark:text-zinc-600"
      >
        <AnimatePresence>
          {!flattened ? (
            <motion.g
              key="orbit"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
            >
              {[...Array(SQUARES)].map((_, i) => {
                const angle = (360 / SQUARES) * i
                const rad = (angle * Math.PI) / 180
                const x = CENTER + RADIUS * Math.cos(rad)
                const y = CENTER + RADIUS * Math.sin(rad)
                return (
                  <motion.rect
                    key={i}
                    x={x - 5}
                    y={y - 5}
                    width="10"
                    height="10"
                    rx="1"
                    fill="currentColor"
                    animate={{ rotate: 360 }}
                    transition={{
                      repeat: Infinity,
                      duration: 8,
                      ease: 'linear'
                    }}
                  />
                )
              })}
            </motion.g>
          ) : (
            <motion.g
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1 }}
            >
              {[...Array(SQUARES)].map((_, i) => {
                const cols = 4
                const spacing = 20
                const x = 60 + (i % cols) * spacing
                const y = 60 + Math.floor(i / cols) * spacing
                return (
                  <motion.rect
                    key={i}
                    x={x}
                    y={y}
                    width="10"
                    height="10"
                    rx="1"
                    fill="currentColor"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: i * 0.1 }}
                  />
                )
              })}

              {/* Optional lines connecting blocks */}
              {[
                [0, 1],
                [1, 2],
                [2, 3],
                [0, 4]
              ].map(([a, b], i) => {
                const cols = 4
                const spacing = 20
                const ax = 65 + (a % cols) * spacing
                const ay = 65 + Math.floor(a / cols) * spacing
                const bx = 65 + (b % cols) * spacing
                const by = 65 + Math.floor(b / cols) * spacing
                return (
                  <motion.line
                    key={i}
                    x1={ax}
                    y1={ay}
                    x2={bx}
                    y2={by}
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 1 + i * 0.2, duration: 0.5 }}
                  />
                )
              })}
            </motion.g>
          )}
        </AnimatePresence>
      </svg>
    </div>
  )
}

import { motion, AnimatePresence } from 'framer-motion'

interface JsonDialogProps {
  isOpen: boolean
  title?: string
  jsonText: string
  onClose: () => void
}

export default function JsonDialog({ isOpen, title = 'Details', jsonText, onClose }: JsonDialogProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg p-4 w-[90vw] max-w-3xl max-h-[80vh] flex flex-col"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold">{title}</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    try { navigator.clipboard.writeText(jsonText) } catch {}
                  }}
                  className="px-2 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                >
                  Copy
                </button>
                <button
                  onClick={onClose}
                  className="px-2 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <pre className="text-xs whitespace-pre-wrap break-words bg-white/80 dark:bg-black/30 p-2 rounded border border-zinc-200 dark:border-zinc-700">
{jsonText}
              </pre>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}


import { memo } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

export const CustomControls = memo(() => {
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  return (
    <div className="absolute left-4 bottom-4 z-20 pointer-events-auto flex flex-col space-y-2 p-1 rounded border bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 shadow-md">
      <button
        onClick={(e) => {
          e.preventDefault()
          zoomIn({ duration: 200 })
        }}
        className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-black dark:text-white"
        title="Zoom In"
      >
        <ZoomIn size={16} />
      </button>
      <button
        onClick={(e) => {
          e.preventDefault()
          zoomOut({ duration: 200 })
        }}
        className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-black dark:text-white"
        title="Zoom Out"
      >
        <ZoomOut size={16} />
      </button>
      <button
        onClick={(e) => {
          e.preventDefault()
          fitView({ duration: 200 })
        }}
        className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-black dark:text-white"
        title="Fit View"
      >
        <Maximize2 size={16} />
      </button>
    </div>
  )
})

export default CustomControls

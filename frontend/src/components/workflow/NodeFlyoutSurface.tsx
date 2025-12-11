import {
  useCallback,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react'

import { useWorkflowFlyout } from './useWorkflowFlyout'

interface NodeFlyoutSurfaceProps {
  nodeId: string
  children: ReactNode
  hoverLabel?: string
  className?: string
}

const DRAG_THRESHOLD_PX = 6

export default function NodeFlyoutSurface({
  nodeId,
  children,
  hoverLabel = 'Click to edit',
  className = ''
}: NodeFlyoutSurfaceProps) {
  const { openFlyout, isFlyoutRender } = useWorkflowFlyout()
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    draggedRef.current = false
  }, [])

  const handleMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    if (draggedRef.current) return
    const deltaX = Math.abs(event.clientX - dragStartRef.current.x)
    const deltaY = Math.abs(event.clientY - dragStartRef.current.y)
    if (deltaX > DRAG_THRESHOLD_PX || deltaY > DRAG_THRESHOLD_PX) {
      draggedRef.current = true
    }
  }, [])

  const handleTrigger = useCallback(() => {
    if (isFlyoutRender) return
    openFlyout(nodeId)
  }, [isFlyoutRender, nodeId, openFlyout])

  const handleMouseUp = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const wasDragged = draggedRef.current
      dragStartRef.current = null
      draggedRef.current = false
      if (wasDragged) return
      handleTrigger()
    },
    [handleTrigger]
  )

  const handleMouseLeave = useCallback(() => {
    dragStartRef.current = null
    draggedRef.current = false
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (isFlyoutRender) return
      openFlyout(nodeId)
    },
    [isFlyoutRender, nodeId, openFlyout]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
      onClick={() => handleTrigger()}
      className={`group relative rounded-lg border border-dashed border-zinc-200 bg-white/60 px-3 py-2 text-zinc-600 transition-colors hover:bg-zinc-900/5 focus:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-white/10 cursor-pointer ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 rounded-lg bg-zinc-900/10 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-white/10" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-700 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-zinc-100">
        {hoverLabel}
      </div>
      <div className="relative transition-opacity duration-150 group-hover:opacity-25 group-focus-visible:opacity-25">
        {children}
      </div>
    </div>
  )
}

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

interface TableDragState {
  pointerId: number
  scrollLeft: number
  startX: number
}

export interface TableScrollEdges {
  left: boolean
  right: boolean
}

/** 管理源表格的横向拖拽、尺寸观察和边缘阴影 */
export function useSourceTableScroll(
  rowCount: number,
  showBackups: boolean,
): {
  isDragging: boolean
  scrollEdges: TableScrollEdges
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  updateScrollEdges: () => void
  startHorizontalDrag: (event: React.PointerEvent<HTMLDivElement>) => void
  moveHorizontalDrag: (event: React.PointerEvent<HTMLDivElement>) => void
  stopHorizontalDrag: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const [isDragging, setIsDragging] = useState(false)
  const [scrollEdges, setScrollEdges] = useState<TableScrollEdges>({ left: false, right: false })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<TableDragState | undefined>(undefined)
  /** 更新滚动边缘状态 */
  const updateScrollEdges = useCallback((): void => {
    const container = scrollContainerRef.current
    if (!container) return

    const nextEdges = {
      left: container.scrollLeft > 1,
      right: container.scrollLeft + container.clientWidth < container.scrollWidth - 1,
    }
    setScrollEdges((current) =>
      current.left === nextEdges.left && current.right === nextEdges.right ? current : nextEdges,
    )
  }, [])

  /** 观察容器尺寸并同步表格滚动边缘 */
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    updateScrollEdges()
    const resizeObserver = new ResizeObserver(updateScrollEdges)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [rowCount, showBackups, updateScrollEdges])

  /** 开始横向拖拽 */
  const startHorizontalDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return
    const target = event.target as HTMLElement
    if (
      target.closest(
        'button, a, input, textarea, select, [role="button"], [role="checkbox"], [role="switch"], [data-table-drag-ignore]',
      )
    )
      return

    const container = scrollContainerRef.current
    if (!container || container.scrollWidth <= container.clientWidth) return

    dragStateRef.current = {
      pointerId: event.pointerId,
      scrollLeft: container.scrollLeft,
      startX: event.clientX,
    }
    container.setPointerCapture(event.pointerId)
    setIsDragging(true)
    event.preventDefault()
  }

  /** 根据指针位置更新横向拖拽距离 */
  const moveHorizontalDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dragState = dragStateRef.current
    const container = scrollContainerRef.current
    if (!dragState || !container || dragState.pointerId !== event.pointerId) return

    container.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.startX)
    updateScrollEdges()
    event.preventDefault()
  }

  /** 停止横向拖拽 */
  const stopHorizontalDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dragState = dragStateRef.current
    const container = scrollContainerRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    if (container?.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
    dragStateRef.current = undefined
    setIsDragging(false)
  }

  return {
    isDragging,
    scrollEdges,
    scrollContainerRef,
    updateScrollEdges,
    startHorizontalDrag,
    moveHorizontalDrag,
    stopHorizontalDrag,
  }
}

import { useRef } from 'react'
import { clamp } from 'es-toolkit/math'
import type { MiniWindowBounds, MiniWindowPlaybackContext, MiniWindowResizeCorner } from '@/types'
import { moveMiniWindow, resizeMiniWindow } from '@/platform/api'

interface MiniWindowSizeConfig {
  aspectRatio: number
  minWidth: number
  maxWidth: number
}

/** 视频迷你窗口的默认和最小尺寸约束 */
const VIDEO_SIZE_CONFIG: MiniWindowSizeConfig = {
  aspectRatio: 16 / 9,
  minWidth: 200,
  maxWidth: 960,
}

/** 电台迷你窗口的默认和最小尺寸约束 */
const RADIO_SIZE_CONFIG: MiniWindowSizeConfig = {
  aspectRatio: 184 / 44,
  minWidth: 184,
  maxWidth: 184,
}

interface ResizeGesture {
  pointerId: number
  corner: MiniWindowResizeCorner
  pointerX: number
  pointerY: number
  bounds: MiniWindowBounds
}

interface MoveGesture {
  pointerId: number
  pointerX: number
  pointerY: number
  x: number
  y: number
}

/** 判断缩放手柄是否位于左侧边角 */
function isLeftCorner(corner: MiniWindowResizeCorner): boolean {
  return corner === 'top-left' || corner === 'bottom-left'
}

/** 判断缩放手柄是否位于上侧边角 */
function isTopCorner(corner: MiniWindowResizeCorner): boolean {
  return corner === 'top-left' || corner === 'top-right'
}

/** 根据拖拽方向和指针位置计算窗口边界 */
function getResizedBounds(
  corner: MiniWindowResizeCorner,
  bounds: MiniWindowBounds,
  width: number,
  height: number,
): MiniWindowBounds {
  return {
    x: isLeftCorner(corner) ? bounds.x + bounds.width - width : bounds.x,
    y: isTopCorner(corner) ? bounds.y + bounds.height - height : bounds.y,
    width,
    height,
  }
}

/** 管理小窗的移动和等比例缩放手势 */
export function useMiniWindowGestures(playback: MiniWindowPlaybackContext | undefined): {
  startMove: (event: React.PointerEvent<HTMLDivElement>) => void
  move: (event: React.PointerEvent<HTMLDivElement>) => void
  stopMove: (event: React.PointerEvent<HTMLDivElement>) => void
  startResize: (corner: MiniWindowResizeCorner, event: React.PointerEvent<HTMLDivElement>) => void
  resize: (event: React.PointerEvent<HTMLDivElement>) => void
  stopResize: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const resizeGestureRef = useRef<ResizeGesture | undefined>(undefined)
  const moveGestureRef = useRef<MoveGesture | undefined>(undefined)
  /** 开始缩放 */
  const startResize = (corner: MiniWindowResizeCorner, event: React.PointerEvent<HTMLDivElement>): void => {
    if (!playback) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeGestureRef.current = {
      pointerId: event.pointerId,
      corner,
      pointerX: event.screenX,
      pointerY: event.screenY,
      bounds: {
        x: window.screenX,
        y: window.screenY,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    }
  }

  /** 根据指针位置调整迷你窗口尺寸 */
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGestureRef.current
    if (!playback || !gesture || gesture.pointerId !== event.pointerId) return
    const config = playback.variant === 'radio' ? RADIO_SIZE_CONFIG : VIDEO_SIZE_CONFIG
    const horizontalChange = isLeftCorner(gesture.corner)
      ? gesture.pointerX - event.screenX
      : event.screenX - gesture.pointerX
    const verticalChange = isTopCorner(gesture.corner)
      ? (gesture.pointerY - event.screenY) * config.aspectRatio
      : (event.screenY - gesture.pointerY) * config.aspectRatio
    const width = clamp(
      Math.round(
        gesture.bounds.width +
          (Math.abs(horizontalChange) >= Math.abs(verticalChange) ? horizontalChange : verticalChange),
      ),
      config.minWidth,
      config.maxWidth,
    )
    const height = Math.round(width / config.aspectRatio)
    const bounds = getResizedBounds(gesture.corner, gesture.bounds, width, height)
    void resizeMiniWindow({ sessionId: playback.sessionId, corner: gesture.corner, bounds })
  }

  /** 停止缩放 */
  const stopResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    resizeGestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  /** 开始拖动迷你窗口 */
  const startMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!playback || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    moveGestureRef.current = {
      pointerId: event.pointerId,
      pointerX: event.screenX,
      pointerY: event.screenY,
      x: window.screenX,
      y: window.screenY,
    }
  }

  /** 根据指针位置移动迷你窗口 */
  const move = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = moveGestureRef.current
    if (!playback || !gesture || gesture.pointerId !== event.pointerId) return
    void moveMiniWindow({
      sessionId: playback.sessionId,
      position: {
        x: gesture.x + event.screenX - gesture.pointerX,
        y: gesture.y + event.screenY - gesture.pointerY,
      },
    })
  }

  /** 结束迷你窗口拖动 */
  const stopMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = moveGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    moveGestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return { startMove, move, stopMove, startResize, resize, stopResize }
}

import type { MediaStreamType } from './media'

export interface MiniWindowPlaybackContext {
  sessionId: string
  src: string
  sourceType?: MediaStreamType
  title?: string
  variant: 'vod' | 'live'
  initialTime: number
  loop: boolean
  audioTrackUrl?: string
}

export interface MiniWindowPlaybackExit {
  sessionId: string
  currentTime: number
}

export type MiniWindowResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface MiniWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface MiniWindowResizeInput {
  sessionId: string
  corner: MiniWindowResizeCorner
  bounds: MiniWindowBounds
}

export interface MiniWindowMoveInput {
  sessionId: string
  position: Pick<MiniWindowBounds, 'x' | 'y'>
}

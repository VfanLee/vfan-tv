import type { MediaStreamType } from './media'
import type { RadioChannel } from './radio'

export interface VideoMiniWindowPlaybackContext {
  sessionId: string
  src: string
  sourceType?: MediaStreamType
  title?: string
  variant: 'vod' | 'live'
  initialTime: number
  loop: boolean
  audioTrackUrl?: string
}

export interface RadioMiniWindowPlaybackContext {
  sessionId: string
  variant: 'radio'
  channel: RadioChannel
  isMuted: boolean
  volume: number
}

export type MiniWindowPlaybackContext = VideoMiniWindowPlaybackContext | RadioMiniWindowPlaybackContext

export interface VideoMiniWindowPlaybackExit {
  sessionId: string
  variant: 'vod' | 'live'
  currentTime: number
}

export interface RadioMiniWindowPlaybackExit {
  sessionId: string
  variant: 'radio'
  channel: RadioChannel
  isPlaying: boolean
  isMuted: boolean
  volume: number
}

export type MiniWindowPlaybackExit = VideoMiniWindowPlaybackExit | RadioMiniWindowPlaybackExit

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

import type { ReactNode } from 'react'
import type { MediaStreamType } from '@shared/types'

export type PlayerVariant = 'vod' | 'live'

export interface PlayerNavigationLabels {
  previous: string
  next: string
}

export interface MiniWindowPlayerController {
  togglePlayback: () => void
  toggleMuted: () => void
  seekBy: (seconds: number) => void
}

export interface MiniWindowPlayerState {
  isPlaying: boolean
  isMuted: boolean
}

export interface PlayerRuntimeInfo {
  firstFrameMs?: number
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  decoder?: string
  hardwareDecoding?: boolean
  videoBitrate?: number
  audioBitrate?: number
  dynamicRange?: string
  audioChannels?: string
  audioSampleRate?: number
}

export interface MediaTrackOption {
  id: string
  label: string
  description?: string
  selected: boolean
  disabled?: boolean
  onSelect?: () => void
}

export interface MediaTrackSelection {
  title: string
  hint?: string
  options: MediaTrackOption[]
}

export interface BasicPlayerProps {
  enableAutoNext?: boolean
  autoPlay?: boolean
  audioTrackUrl?: string
  className?: string
  src?: string
  sourceType?: MediaStreamType
  mediaSessionId?: string
  title?: string
  initialTime?: number
  isResolvingSource?: boolean
  hasNextEpisode?: boolean
  hasPreviousEpisode?: boolean
  hidePlaybackSettings?: boolean
  isTheaterMode?: boolean
  loop?: boolean
  /** 小窗模式仅保留视频画面，窗口级退出入口由小窗页面提供。 */
  miniWindowMode?: boolean
  playerOverlay?: ReactNode
  playerOverlayPinned?: boolean
  showMediaTrackSettings?: boolean
  onMiniWindowControllerReady?: (controller: MiniWindowPlayerController | null) => void
  onMiniWindowPlayerStateChange?: (state: MiniWindowPlayerState) => void
  persistPlaybackSettings?: boolean
  navigationLabels?: PlayerNavigationLabels
  formatPlaybackUrl?: (src: string) => string
  onNextEpisode?: () => void
  onEnded?: () => void
  onPreviousEpisode?: () => void
  onProgress?: (progress: { currentTime: number; duration: number; force?: boolean }) => void
  onPlaybackReady?: () => void
  onPlaybackError?: (reason: string) => void
  onRuntimeInfoChange?: (info: PlayerRuntimeInfo) => void
  onSettingsVisibilityChange?: (visible: boolean) => void
  onToggleTheaterMode?: () => void
  variant?: PlayerVariant
}

export interface CustomSliderInput {
  title: string
  initialValue: number
  min: number
  max: number
  step: number
  suffix: string
  presets: readonly number[]
  normalPreset?: number
  formatValue: (value: number) => string
  onChange: (value: number) => void
}

export interface DisplaySettingsState {
  aspectRatio: string
  flip: string
  videoTrack?: {
    label: string
    onClick: () => void
  }
  audioTrack?: {
    label: string
    onClick: () => void
  }
  playbackRate: number
  seekStep: number
  loop: boolean
  autoNext: boolean
  showPlaybackSettings: boolean
  showAutoNext: boolean
  onAspectRatio: () => void
  onFlip: () => void
  onPlaybackRate: () => void
  onSeekStep: () => void
  onLoop: () => void
  onAutoNext: () => void
}

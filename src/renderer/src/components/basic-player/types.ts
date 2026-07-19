import type { MediaStreamType } from '@shared/types'

export type PlayerVariant = 'vod' | 'live'

export interface PlayerNavigationLabels {
  previous: string
  next: string
}

export interface BasicPlayerProps {
  enableAutoNext?: boolean
  autoPlay?: boolean
  audioTrackUrl?: string
  className?: string
  src?: string
  sourceType?: MediaStreamType
  title?: string
  initialTime?: number
  isResolvingSource?: boolean
  hasNextEpisode?: boolean
  hasPreviousEpisode?: boolean
  isTheaterMode?: boolean
  loop?: boolean
  persistPlaybackSettings?: boolean
  navigationLabels?: PlayerNavigationLabels
  formatPlaybackUrl?: (src: string) => string
  onNextEpisode?: () => void
  onEnded?: () => void
  onPreviousEpisode?: () => void
  onProgress?: (progress: { currentTime: number; duration: number }) => void
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

import type { VodSearchResult } from '@shared/types'

export interface EpisodeSelection {
  resourceKey: string
  lineIndex: number
  episodeIndex: number
}

export type PlayerTab = 'episodes' | 'sources'

export interface SourceRefreshState {
  found: number
  failed: number
  finished: number
}

export type SourceProbeState =
  { status: 'loading' } | { status: 'complete'; latencyMs: number | null; quality: string | null }

export interface SourceProbeRequest {
  items: VodSearchResult[]
  lineIndex: number
  episodeIndex: number
}

export interface PlayerLocationState {
  initialTime?: number
  episodeUrl?: string
  preferredEpisodeIndex?: number
  preferredLineIndex?: number
}

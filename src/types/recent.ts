import type { VodSearchResult } from './vod'

export interface RecentPlayItem {
  sourceId: string
  sourceName: string
  vodId: string
  title: string
  poster?: string
  lineName: string
  episodeName: string
  episodeUrl: string
  positionSeconds: number
  duration: number
  rawJson?: string
  playedAt: number
  updateInfo?: RecentUpdateInfo
}

export type RecentPlayInput = Omit<RecentPlayItem, 'updateInfo'>

export interface RecentUpdateInfo {
  latestDetail: VodSearchResult
  checkedAt: number
  episodeCount: number
  pendingEpisodeCount: number
  newEpisodeKeys: string[]
  revision: string
  remarks?: string | null
}

export interface RecentUpdateCheckResult {
  sourceId: string
  vodId: string
  error?: string | null
}

export interface RecentVodDetailRefresh {
  detail: VodSearchResult
  updateInfo?: RecentUpdateInfo | null
}

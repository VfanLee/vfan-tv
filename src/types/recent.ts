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
}

export type RecentPlayInput = RecentPlayItem

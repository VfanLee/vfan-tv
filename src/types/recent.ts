export interface RecentPlayItem {
  id: string
  sourceId: string
  sourceName: string
  vodId: string
  title: string
  poster?: string
  lineName: string
  episodeName: string
  episodeUrl: string
  currentTime: number
  duration: number
  rawJson?: string
  playedAt: number
}

export type RecentPlayUniqueInput = Pick<RecentPlayItem, 'sourceId' | 'vodId' | 'lineName' | 'episodeName'>

export type RecentPlayInput = RecentPlayItem

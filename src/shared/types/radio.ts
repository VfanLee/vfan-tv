export interface RadioCategory {
  id: number
  title: string
}

export interface RadioRegion {
  id: number
  title: string
}

export interface RadioChannel {
  id: number
  title: string
  coverUrl?: string
  description?: string
  audienceCount?: number
  category?: RadioCategory
  region?: RadioRegion
  nowPlayingTitle?: string
}

export interface RadioLiveProgram {
  channelId: number
  title?: string
}

export interface RadioSearchResult {
  items: RadioChannel[]
  hasMore: boolean
}

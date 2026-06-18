export interface VodSearchResult {
  sourceId: string
  sourceName: string
  sourceBaseUrl?: string
  sourceHeaders?: Record<string, string>
  vodId: string
  title: string
  subtitle?: string
  poster?: string
  year?: string
  area?: string
  language?: string
  category?: string
  remarks?: string
  actor?: string
  director?: string
  description?: string
  raw: unknown
  rawJson?: string
}

export interface RecommendationItem {
  id: string
  title: string
  subtitle?: string
  poster?: string
  rating?: number
  ratingStarCount?: number
  isNew?: boolean
  category: 'movie' | 'tv' | 'show'
  raw: unknown
}

export interface PlayLine {
  name: string
  episodes: PlayEpisode[]
}

export interface PlayEpisode {
  name: string
  url: string
}

export interface VodApiResponse {
  code: number
  msg: string
  page: number
  pagecount: number
  limit: number
  total: number
  list: VodApiItem[]
}

export interface VodApiItem {
  vod_id: number
  vod_name: string
  vod_sub: string
  vod_pic: string
  vod_actor: string
  vod_director: string
  vod_class: string
  vod_remarks: string
  vod_area: string
  vod_lang: string
  vod_yea?: string
  vod_year: string
  vod_content: string
  vod_play_from: string
  vod_play_note?: string
  vod_play_server?: string
  vod_play_url: string
  vod_douban_score?: string
  vod_pubdate?: string
  vod_state?: string
  vod_writer?: string
  type_name: string
  [key: string]: unknown
}

import type { RecentPlayItem } from './recent'
import type { RecommendationItem } from './vod'

export interface HomeData {
  recentPlays: RecentPlayItem[]
  recommendations: RecommendationItem[]
}

export interface HotRecommendationsRequest {
  category: RecommendationItem['category']
  type: HotRecommendationType
  start: number
  limit: number
}

export type HotRecommendationType =
  | '全部'
  | '华语'
  | '欧美'
  | '韩国'
  | '日本'
  | 'tv'
  | 'tv_domestic'
  | 'tv_american'
  | 'tv_japanese'
  | 'tv_korean'
  | 'tv_animation'
  | 'tv_documentary'
  | 'show'
  | 'show_domestic'
  | 'show_foreign'

export interface HotRecommendationsPage {
  items: RecommendationItem[]
  start: number
  limit: number
  nextStart: number
  hasMore: boolean
}

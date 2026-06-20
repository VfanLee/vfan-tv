import type { HomeData, HotRecommendationsPage, HotRecommendationsRequest, RecommendationItem } from '@shared/types'
import { requireRuntimeApi } from './client'

export const categorySections: Array<{
  key: RecommendationItem['category']
  title: string
}> = [
  { key: 'movie', title: '电影' },
  { key: 'tv', title: '电视剧' },
  { key: 'show', title: '综艺' },
]

export async function getHomeData(): Promise<HomeData> {
  return requireRuntimeApi().home.get()
}

export async function getHotRecommendationsPage(input: HotRecommendationsRequest): Promise<HotRecommendationsPage> {
  return requireRuntimeApi().home.getHot(input)
}

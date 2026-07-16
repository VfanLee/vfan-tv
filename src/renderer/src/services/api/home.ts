import type { HomeData, HotRecommendationsPage, HotRecommendationsRequest } from '@shared/types'
import { requireRuntimeApi } from './client'

export async function getHomeData(): Promise<HomeData> {
  return requireRuntimeApi().home.get()
}

export async function getHotRecommendationsPage(input: HotRecommendationsRequest): Promise<HotRecommendationsPage> {
  return requireRuntimeApi().home.getHot(input)
}

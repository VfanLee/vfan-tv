import type { HotRecommendationType, RecommendationItem } from '@shared/types'
import { categorySections, type HotCategorySection } from '@renderer/constants'

export function getHotCategorySection(category: string | undefined): HotCategorySection {
  return categorySections.find((section) => section.key === category) ?? categorySections[0]
}

export function getHotCacheKey(category: RecommendationItem['category'], type: HotRecommendationType): string {
  return `${category}:${type}`
}

import type {
  HomeData,
  HotRecommendationType,
  HotRecommendationsPage,
  HotRecommendationsRequest,
  RecommendationItem,
} from '@shared/types'
import { requireRuntimeApi } from './client'

export interface HotCategorySection {
  key: RecommendationItem['category']
  title: string
  defaultType: HotRecommendationType
  filters: Array<{ label: string; value: HotRecommendationType }>
}

export const categorySections: HotCategorySection[] = [
  {
    key: 'movie',
    title: '电影',
    defaultType: '全部',
    filters: [
      { label: '全部', value: '全部' },
      { label: '华语', value: '华语' },
      { label: '欧美', value: '欧美' },
      { label: '韩国', value: '韩国' },
      { label: '日本', value: '日本' },
    ],
  },
  {
    key: 'tv',
    title: '剧集',
    defaultType: 'tv',
    filters: [
      { label: '综合', value: 'tv' },
      { label: '国产剧', value: 'tv_domestic' },
      { label: '欧美剧', value: 'tv_american' },
      { label: '日剧', value: 'tv_japanese' },
      { label: '韩剧', value: 'tv_korean' },
      { label: '动画', value: 'tv_animation' },
      { label: '纪录片', value: 'tv_documentary' },
    ],
  },
  {
    key: 'show',
    title: '综艺',
    defaultType: 'show',
    filters: [
      { label: '综合', value: 'show' },
      { label: '国内', value: 'show_domestic' },
      { label: '国外', value: 'show_foreign' },
    ],
  },
]

export function getHotCategorySection(category: string | undefined): HotCategorySection {
  return categorySections.find((section) => section.key === category) ?? categorySections[0]
}

export function getHotCacheKey(category: RecommendationItem['category'], type: HotRecommendationType): string {
  return `${category}:${type}`
}

export async function getHomeData(): Promise<HomeData> {
  return requireRuntimeApi().home.get()
}

export async function getHotRecommendationsPage(input: HotRecommendationsRequest): Promise<HotRecommendationsPage> {
  return requireRuntimeApi().home.getHot(input)
}

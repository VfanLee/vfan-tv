import { BookOpen, Clapperboard, Film, Mic2, Tv } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HotRecommendationType, RecommendationItem } from '@shared/types'

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
    title: '电视剧',
    defaultType: 'tv_domestic',
    filters: [
      { label: '国产剧', value: 'tv_domestic' },
      { label: '欧美剧', value: 'tv_american' },
      { label: '日剧', value: 'tv_japanese' },
      { label: '韩剧', value: 'tv_korean' },
    ],
  },
  {
    key: 'animation',
    title: '动画',
    defaultType: 'tv_animation',
    filters: [{ label: '动画', value: 'tv_animation' }],
  },
  {
    key: 'documentary',
    title: '纪录片',
    defaultType: 'tv_documentary',
    filters: [{ label: '纪录片', value: 'tv_documentary' }],
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

export const categoryIcons: Record<RecommendationItem['category'], LucideIcon> = {
  animation: Clapperboard,
  documentary: BookOpen,
  movie: Film,
  show: Mic2,
  tv: Tv,
}

import { BookOpen, Clapperboard, Film, Mic2, Tv } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RecommendationItem } from '@shared/types'

export const categoryIcons: Record<RecommendationItem['category'], LucideIcon> = {
  animation: Clapperboard,
  documentary: BookOpen,
  movie: Film,
  show: Mic2,
  tv: Tv,
}

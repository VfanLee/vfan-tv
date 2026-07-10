import type { SearchSourceStatus, VodSearchResult } from '@shared/types'

export interface SourceSearchState {
  sourceId: string
  sourceName: string
  status: SearchSourceStatus
  items: VodSearchResult[]
  message?: string
}

export interface GroupedSearchResult {
  key: string
  title: string
  poster?: string
  posterSourceUrl?: string
  meta: string
  remarks?: string
  items: VodSearchResult[]
  sourceNames: string[]
}

export interface SearchSourceStats {
  searching: number
  success: number
  empty: number
  failed: number
  total: number
}

export type ResultViewMode = 'grouped' | 'source'

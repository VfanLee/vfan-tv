export interface FavoriteItem {
  id: string
  sourceId: string
  sourceName: string
  sourceBaseUrl?: string
  sourceHeaders?: Record<string, string>
  vodId: string
  title: string
  poster?: string
  year?: string
  area?: string
  language?: string
  category?: string
  remarks?: string
  actor?: string
  director?: string
  description?: string
  rawJson?: string
  createdAt: number
  updatedAt: number
}

export type FavoriteInput = Omit<FavoriteItem, 'createdAt' | 'updatedAt'>
